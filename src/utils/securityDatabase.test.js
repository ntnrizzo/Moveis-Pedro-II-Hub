import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

let db;
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
async function identity(user = 10, role = 'authenticated') {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${user ? id(user) : ''}',false); SELECT set_config('request.jwt.claim.role','${role}',false); SET ROLE ${role};`);
}
async function reset() { await db.exec('RESET ROLE'); }
async function scalar(sql, params = []) { return Object.values((await db.query(sql, params)).rows[0])[0]; }

beforeAll(async () => {
    db = new PGlite();
    await db.exec(readFileSync(new URL('../../tests/security/schema-fixture.sql', import.meta.url), 'utf8'));
    const dir = new URL('../../supabase/migrations/', import.meta.url);
    for (const file of readdirSync(dir).filter(name => name.startsWith('2026090512') || name.startsWith('202609081') || name.startsWith('2026090912')).sort()) {
        try { await db.exec(readFileSync(new URL(file, dir), 'utf8')); }
        catch (e) { throw new Error(`${file}: ${e.message}`); }
    }
    await db.exec(`
      INSERT INTO organizations(id) VALUES('${id(1)}'),('${id(2)}');
      INSERT INTO public_users(id,organization_id,cargo,ativo) VALUES
        ('${id(10)}','${id(1)}','Vendedor',true),('${id(11)}','${id(1)}','Administrador',true),('${id(12)}','${id(2)}','Administrador',true);
      INSERT INTO clientes VALUES('${20}','${id(1)}','${id(13)}'),('${21}','${id(2)}',NULL);
      INSERT INTO lojas VALUES('${id(30)}','${id(1)}','CD'),('${id(31)}','${id(2)}','CD');
      INSERT INTO produtos VALUES('${40}','${id(1)}','Produto',NULL,5,5,0),('${41}','${id(2)}','Outro',NULL,5,5,0);
      INSERT INTO produto_variantes VALUES('${id(50)}','${id(1)}','${40}');
      INSERT INTO estoque(organization_id,variante_id,loja_id,quantidade) VALUES('${id(1)}','${id(50)}','${id(30)}',1);
    `);
}, 30000);
afterAll(async () => { await db?.close(); });

describe('PostgreSQL permissions', () => {
    it('allows Financeiro to pay/edit own entries but rejects foreign, inactive and seller updates', async () => {
        await reset();
        await db.exec(`INSERT INTO public_users(id,organization_id,cargo,ativo) VALUES
          ('${id(901)}','${id(1)}','Financeiro',true),
          ('${id(902)}','${id(1)}','Financeiro',false);
          INSERT INTO lancamentos_financeiros(id,organization_id,status,descricao) VALUES
          ('${903}','${id(1)}','Pendente','Conta'),
          ('${904}','${id(2)}','Pendente','Outra conta');`);
        await identity(901);
        expect((await db.query("UPDATE lancamentos_financeiros SET status='Pago',descricao='Editada' WHERE id=$1 RETURNING status,descricao", [903])).rows)
            .toEqual([{ status: 'Pago', descricao: 'Editada' }]);
        expect((await db.query("UPDATE lancamentos_financeiros SET status='Pago' WHERE id=$1 RETURNING id", [904])).rows).toHaveLength(0);
        await expect(db.query('UPDATE lancamentos_financeiros SET organization_id=$1 WHERE id=$2', [id(2),903])).rejects.toThrow(/row-level security/);
        for (const user of [10,902]) {
            await identity(user);
            expect((await db.query("UPDATE lancamentos_financeiros SET status='Pendente' WHERE id=$1 RETURNING id", [903])).rows).toHaveLength(0);
        }
    });
    it('does not expose clients to anonymous callers', async () => {
        await identity(null, 'anon');
        await expect(db.query('SELECT * FROM clientes')).rejects.toThrow(/permission denied/);
    });
    it('prevents self escalation, including custom permissions', async () => {
        await identity();
        await expect(db.query(`UPDATE public_users SET cargo='Administrador' WHERE id=$1`, [id(10)])).rejects.toThrow(/privilégios/);
        await expect(db.query(`UPDATE public_users SET custom_permissions='{"all":true}' WHERE id=$1`, [id(10)])).rejects.toThrow(/privilégios/);
        await db.query('UPDATE public_users SET nome=$1 WHERE id=$2', ['Novo nome', id(10)]);
    });
    it('allows admin changes only within the same organization', async () => {
        await identity(11);
        expect((await db.query(`UPDATE public_users SET nome='other' WHERE id=$1 RETURNING id`, [id(12)])).rows).toHaveLength(0);
    });
});

function sale(n, variant = false, qty = 1) {
    return { id: id(n), organization_id: id(1), cliente_id: 20, loja: 'CD', numero_pedido: String(n),
        valor_total: 10, valor_pago: 0, itens: [{ produto_id: 40, quantidade: qty, origem_estoque_campo: 'estoque_cd', ...(variant ? { variante_id: id(50) } : {}) }] };
}
describe('atomic sale and inventory', () => {
    it('rolls back the whole sale if one item cannot be fulfilled', async () => {
        await identity();
        const payload = sale(60, false, 1);
        payload.itens.push({ ...payload.itens[0], quantidade: 5 });
        await expect(db.query('SELECT registrar_venda_pdv($1::jsonb)', [JSON.stringify(payload)])).rejects.toThrow(/Estoque insuficiente/);
        await reset();
        expect(await scalar('SELECT count(*)::int FROM vendas WHERE numero_pedido=$1', ['60'])).toBe(0);
        expect(await scalar('SELECT quantidade_estoque FROM produtos WHERE id=$1', [40])).toBe(5);
    });
    it('replaying the offline ID does not debit inventory twice', async () => {
        await identity();
        const payload = JSON.stringify(sale(61));
        await db.query('SELECT registrar_venda_pdv($1::jsonb)', [payload]);
        await db.query('SELECT registrar_venda_pdv($1::jsonb)', [payload]);
        await reset();
        expect(await scalar('SELECT quantidade_estoque FROM produtos WHERE id=$1', [40])).toBe(4);
        expect(await scalar('SELECT count(*)::int FROM vendas WHERE numero_pedido=$1', ['61'])).toBe(1);
    });
    it('accepts only one of two requests for the last variant unit', async () => {
        await identity();
        const results = await Promise.allSettled([62,63].map(n => db.query('SELECT registrar_venda_pdv($1::jsonb)', [JSON.stringify(sale(n,true))])));
        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
        await reset();
        expect(await scalar('SELECT quantidade FROM estoque WHERE variante_id=$1', [id(50)])).toBe(0);
    });
    it('rejects null organizations and portal writes', async () => {
        await identity();
        await expect(db.query('SELECT baixar_estoque($1,NULL,1,$2)', [id(50),id(30)])).rejects.toThrow(/inválida/);
        await identity(13);
        expect((await db.query('SELECT id FROM vendas')).rows.length).toBeGreaterThan(0);
        expect((await db.query('DELETE FROM vendas RETURNING id')).rows).toHaveLength(0);
    });
});

describe('receiving purchase orders', () => {
    it('rejects an item from another OC and rolls back the history', async () => {
        await reset();
        await db.exec(`INSERT INTO compras_ordens(id,organization_id,numero_pedido,status,metadata,valor_total,data_pedido,prazo_pagamento)
          VALUES('${id(70)}','${id(1)}','OC-2026-00070','Pedido Enviado','{"loja_id":"${id(30)}"}',20,current_date,30),
          ('${id(71)}','${id(1)}','OC-2026-00071','Pedido Enviado','{}',20,current_date,30);
          INSERT INTO compras_oc_itens(id,organization_id,ordem_compra_id,produto_id,quantidade_recebida,quantidade_pedida,preco_unitario)
          VALUES('${id(72)}','${id(1)}','${id(70)}','${40}',0,2,10),('${id(73)}','${id(1)}','${id(71)}','${40}',0,2,10);`);
        await identity();
        await expect(db.query('SELECT registrar_recebimento_oc($1,$2,$3::jsonb)', [id(70),id(74),JSON.stringify([{ item_id:id(73),quantidade_recebida:1 }])])).rejects.toThrow();
        await reset();
        expect(await scalar('SELECT count(*)::int FROM compras_recebimentos_historico')).toBe(0);
    });
    it('receives once and creates one financial entry across retries', async () => {
        await identity();
        const args=[id(70),id(75),JSON.stringify([{item_id:id(72),quantidade_recebida:2}])];
        await db.query('SELECT registrar_recebimento_oc($1,$2,$3::jsonb)',args);
        await db.query('SELECT registrar_recebimento_oc($1,$2,$3::jsonb)',args);
        await reset();
        expect(await scalar('SELECT quantidade_recebida FROM compras_oc_itens WHERE id=$1',[id(72)])).toBe(2);
        expect(await scalar('SELECT count(*)::int FROM compras_recebimentos_historico')).toBe(1);
        expect(await scalar("SELECT count(*)::int FROM lancamentos_financeiros WHERE origem='OC#OC-2026-00070'")).toBe(1);
    });
    it('allocates distinct OC numbers', async () => {
        await identity();
        const numbers=await Promise.all([1,2,3].map(()=>scalar('SELECT proximo_numero_oc(2026)')));
        expect(new Set(numbers).size).toBe(3);
    });
});

describe('webhook transaction boundary', () => {
    it('does not expose webhook processors to an authenticated employee', async () => {
        await identity();
        await expect(db.query("SELECT processar_asaas_evento('x','PAYMENT_RECEIVED','sub',current_date)")).rejects.toThrow(/permission denied/);
    });
    it('allows an Asaas retry after a transactional failure', async () => {
        await reset();
        await db.query('UPDATE organizations SET asaas_subscription_id=$1,plano_id=$2 WHERE id=$3',['sub-a',id(90),id(1)]);
        await identity(null,'service_role');
        await expect(db.query("SELECT processar_asaas_evento('asaas-a','PAYMENT_RECEIVED','sub-a',current_date)")).rejects.toThrow();
        await reset();
        expect(await scalar("SELECT count(*)::int FROM webhook_events WHERE provider='asaas'")).toBe(0);
        await db.exec(`INSERT INTO planos VALUES('${id(90)}','{"whatsapp":true}'); INSERT INTO organization_settings VALUES('${id(1)}','{}');`);
        await identity(null,'service_role');
        await db.query("SELECT processar_asaas_evento('asaas-a','PAYMENT_RECEIVED','sub-a',current_date)");
        await db.query("SELECT processar_asaas_evento('asaas-a','PAYMENT_RECEIVED','sub-a',current_date)");
        await reset();
        expect(await scalar("SELECT count(*)::int FROM webhook_events WHERE provider='asaas'")).toBe(1);
        expect(await scalar('SELECT status_assinatura FROM organizations WHERE id=$1',[id(1)])).toBe('ativa');
    });
});
