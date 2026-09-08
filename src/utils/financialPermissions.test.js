import { it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

it('permits payment/edit by active Financeiro within the organization only', async () => {
  const db = new PGlite();
  const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  try {
    await db.exec(readFileSync(new URL('../../tests/security/schema-fixture.sql', import.meta.url), 'utf8'));
    for (const file of ['20260905120000_security_identity_rls.sql', '20260908120000_fix_financial_updates.sql']) {
      await db.exec(readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    }
    await db.exec(`INSERT INTO public_users(id,organization_id,cargo,ativo) VALUES
      ('${uuid(10)}','${uuid(1)}','Financeiro',true),
      ('${uuid(11)}','${uuid(1)}','Vendedor',true),
      ('${uuid(12)}','${uuid(1)}','Financeiro',false);
      INSERT INTO lancamentos_financeiros(id,organization_id,status) VALUES
      ('${20}','${uuid(1)}','Pendente'),('${21}','${uuid(2)}','Pendente');`);
    for (const user of [10,11,12]) {
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${uuid(user)}',false);
        SELECT set_config('request.jwt.claim.role','authenticated',false); SET ROLE authenticated;`);
      const result = await db.query("UPDATE lancamentos_financeiros SET status='Pago',descricao='Editada' WHERE id=$1 RETURNING status", [20]);
      expect(result.rows).toHaveLength(user === 10 ? 1 : 0);
      expect((await db.query("UPDATE lancamentos_financeiros SET status='Pago' WHERE id=$1 RETURNING id", [21])).rows).toHaveLength(0);
      if (user === 10) {
        await expect(db.query('UPDATE lancamentos_financeiros SET organization_id=$1 WHERE id=$2', [uuid(2),20])).rejects.toThrow(/row-level security/);
      }
    }
  } finally { await db.close(); }
}, 30000);
