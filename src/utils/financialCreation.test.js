import { beforeAll, afterAll, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

let db;
const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
async function identity(n) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${n ? uuid(n) : ''}',false);
    SELECT set_config('request.jwt.claim.role','${n ? 'authenticated' : 'anon'}',false);
    SET ROLE ${n ? 'authenticated' : 'anon'};`);
}
async function caps(n) {
  await identity(n);
  return (await db.query('SELECT financial_capabilities() AS caps')).rows[0].caps;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(new URL('../../tests/security/schema-fixture.sql', import.meta.url), 'utf8'));
  for (const file of ['20260905120000_security_identity_rls.sql', '20260908120000_fix_financial_updates.sql', '20260909120000_fix_financial_creation.sql']) {
    await db.exec(readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
  for (const [n,role,active,org,roles,custom] of [
    [10,'Financeiro',true,1,[],null], [11,'Vendedor',true,1,[],null],
    [12,'Financeiro',false,1,[],null], [13,'Financeiro',true,2,[],null],
    [14,'Administrador',true,1,[],null], [15,'Gerente',true,1,[],null],
    [16,'Gerente Geral',true,1,[],null], [17,'Cliente',true,1,[],null],
    [18,'Vendedor',true,1,['Financeiro'],null],
    [19,'Financeiro',true,1,[],{denied:['manage_financeiro']}],
    [20,'Financeiro',true,1,[],{inherit:false}],
    [21,'Assistente',true,1,[],{inherit:false,allowed:['manage_financeiro']}],
    [22,'Assistente',true,1,[],null], [23,'Vendedor',true,1,['Administrador'],null],
    [24,'Administrador',false,1,[],null],
  ]) await db.query('INSERT INTO public_users(id,cargo,ativo,organization_id,cargos,custom_permissions) VALUES($1,$2,$3,$4,$5,$6)', [uuid(n),role,active,uuid(org),roles,custom]);
  await db.exec(`INSERT INTO lancamentos_financeiros(id,organization_id,status) VALUES (100,'${uuid(1)}','Pendente'),(101,'${uuid(2)}','Pendente');`);
}, 30000);
afterAll(async () => { await db?.close(); });

it('immediate migration fixes INSERT RETURNING in both organizations and preserves payment updates', async () => {
  for (const [user,org] of [[10,1],[13,2]]) {
    await identity(user);
    const row = (await db.query("INSERT INTO lancamentos_financeiros(descricao,valor,status) VALUES ('Teste',10,'Pendente') RETURNING id,organization_id")).rows[0];
    expect(row.organization_id).toBe(uuid(org));
    expect((await db.query("UPDATE lancamentos_financeiros SET status='Pago' WHERE id=$1 RETURNING id", [row.id])).rows).toHaveLength(1);
    expect((await db.query("INSERT INTO categorias_financeiras(nome) VALUES ('Nova') RETURNING organization_id")).rows[0].organization_id).toBe(uuid(org));
  }
  await db.exec('RESET ROLE');
  await db.exec(readFileSync(new URL('../../supabase/migrations/20260909121000_financial_capabilities.sql', import.meta.url), 'utf8'));
});

it('enforces role matrix, custom grants, inherit=false, multi-role admin and inactive denial', async () => {
  for (const n of [10,11,12,13,14,15,16,17,18,19,20,21,22,23,24]) {
    const access = await caps(n);
    const manages = [10,13,14,18,21,23].includes(n);
    const views = manages || [15,16,19].includes(n);
    expect(access.manage_financeiro, String(n)).toBe(manages);
    expect(access.view_financeiro, String(n)).toBe(views);
    expect(access.delete_financial_entry).toBe([14,23].includes(n));
    expect(access.approve_payment_oc).toBe([14,23].includes(n));
    const create = () => db.query("INSERT INTO lancamentos_financeiros(descricao) VALUES ('Matriz') RETURNING id");
    if (manages) expect((await create()).rows).toHaveLength(1);
    else await expect(create()).rejects.toThrow(/row-level security/);
    const localId = n === 13 ? 101 : 100;
    expect((await db.query('SELECT id FROM lancamentos_financeiros WHERE id=$1', [localId])).rows.length > 0).toBe(views);
    expect((await db.query("UPDATE lancamentos_financeiros SET status='Pago' WHERE id=$1 RETURNING id", [localId])).rows.length > 0).toBe(manages);
    if (![14,23].includes(n)) expect((await db.query('DELETE FROM lancamentos_financeiros WHERE id=$1 RETURNING id', [localId])).rows).toHaveLength(0);
  }
});

it('blocks foreign/null tenant, tenant reassignment and anonymous queries', async () => {
  for (const n of [10,14,23]) {
    await identity(n);
    await expect(db.query('INSERT INTO lancamentos_financeiros(organization_id) VALUES ($1)', [uuid(2)])).rejects.toThrow(/row-level security/);
    await expect(db.query('INSERT INTO lancamentos_financeiros(organization_id) VALUES (NULL)')).rejects.toThrow(/row-level security/);
    await expect(db.query('UPDATE lancamentos_financeiros SET organization_id=$1 WHERE id=100', [uuid(2)])).rejects.toThrow(/row-level security/);
    expect((await db.query('SELECT id FROM lancamentos_financeiros WHERE id=101')).rows).toHaveLength(0);
  }
  await identity(null);
  await expect(db.query('SELECT financial_capabilities()')).rejects.toThrow(/permission denied/);
  await expect(db.query('SELECT * FROM lancamentos_financeiros')).rejects.toThrow(/permission denied/);
});

it('scopes role overrides to tenant and makes denials independent of role order', async () => {
  await db.exec(`RESET ROLE; INSERT INTO role_permissions(organization_id,cargo,permissions,denied_permissions) VALUES
    ('${uuid(1)}','Assistente','["manage_financeiro"]','{}'),
    ('${uuid(2)}','Vendedor','["manage_financeiro"]','{}'),
    ('${uuid(1)}','Restrito','[]','{manage_financeiro}');`);
  expect((await caps(22)).manage_financeiro).toBe(true);
  expect((await caps(11)).manage_financeiro).toBe(false);
  for (const roles of ['{Financeiro,Restrito}','{Restrito,Financeiro}']) {
    await identity(14);
    await db.exec(`UPDATE public_users SET cargos='${roles}' WHERE id='${uuid(18)}';`);
    expect((await caps(18)).manage_financeiro).toBe(false);
  }
  await identity(10);
  await expect(db.query("UPDATE public_users SET cargos='{Administrador}' WHERE id=$1", [uuid(10)])).rejects.toThrow(/privilégios/);
  expect((await db.query("INSERT INTO categorias_financeiras(nome) VALUES ('Financeiro') RETURNING id")).rows).toHaveLength(1);
  expect((await db.query("UPDATE categorias_financeiras SET nome='Não' RETURNING id")).rows).toHaveLength(0);
  expect((await db.query('DELETE FROM categorias_financeiras RETURNING id')).rows).toHaveLength(0);
});

it('forbidden recurrence deletion changes nothing and authorized deletion preserves earlier entries', async () => {
  await db.exec(`RESET ROLE; INSERT INTO lancamentos_financeiros(id,organization_id,recorrente,data_lancamento,origem_ref) VALUES
    (200,'${uuid(1)}',true,'2026-01-01',NULL),
    (201,'${uuid(1)}',false,'2026-02-01','recorrencia:200:2026-02-01'),
    (202,'${uuid(1)}',false,'2026-03-01','recorrencia:200:2026-03-01');`);
  await identity(10);
  await expect(db.query('SELECT delete_financial_recurrence(201)')).rejects.toThrow(/administrador/);
  expect((await db.query('SELECT recorrente FROM lancamentos_financeiros WHERE id=200')).rows[0].recorrente).toBe(true);
  expect((await db.query('SELECT id FROM lancamentos_financeiros WHERE id IN (201,202)')).rows).toHaveLength(2);
  await db.exec("RESET ROLE; CREATE FUNCTION public.test_reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced rollback'; END $$; CREATE TRIGGER test_rollback BEFORE DELETE ON lancamentos_financeiros FOR EACH ROW EXECUTE FUNCTION test_reject_delete()");
  await identity(14);
  await expect(db.query('SELECT delete_financial_recurrence(201)')).rejects.toThrow(/forced rollback/);
  expect((await db.query('SELECT recorrente FROM lancamentos_financeiros WHERE id=200')).rows[0].recorrente).toBe(true);
  await db.exec('RESET ROLE; DROP TRIGGER test_rollback ON lancamentos_financeiros');
  await identity(14);
  const result = (await db.query('SELECT delete_financial_recurrence(201) AS result')).rows[0].result;
  expect(result.deleted_ids.sort()).toEqual(['201','202']);
  expect((await db.query('SELECT recorrente FROM lancamentos_financeiros WHERE id=200')).rows[0].recorrente).toBe(false);
  await expect(db.query('SELECT delete_financial_recurrence(201)')).rejects.toThrow(/não encontrado/);
});
