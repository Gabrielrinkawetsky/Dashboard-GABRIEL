import { db, tx } from "./db.js";
import { ymd } from "./dates.js";

const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return ymd(d); };

export async function seedDemo() {
  if (await db.prepare("SELECT 1 FROM clients WHERE demo=1").get()) return false;
  await tx(async (d) => {
    const cli = d.prepare("INSERT INTO clients (name, company, email, phone, notes, demo) VALUES (?,?,?,?,?,1)");
    const ids = [];
    for (const c of [
      ["Mariana Alves", "Doce Mel Confeitaria", "mariana@exemplo.com", "(11) 90000-0001"],
      ["Rafael Torres", "RT Esportes", "rafael@exemplo.com", "(21) 90000-0002"],
      ["Juliana Prado", "Studio Prado", "juliana@exemplo.com", "(31) 90000-0003"],
      ["Carlos Menezes", "Menezes Advocacia", "carlos@exemplo.com", "(41) 90000-0004"],
      ["Patrícia Nunes", "Pet Feliz", "patricia@exemplo.com", "(51) 90000-0005"],
    ]) ids.push(Number((await cli.run(...c, "Cliente de exemplo")).lastInsertRowid));

    const prop = d.prepare("INSERT INTO proposals (client_id, service, scope, value, deadline, valid_until, status, created_at, decided_at, demo) VALUES (?,?,?,?,?,?,?,?,?,1)");
    const mk = async (c, svc, v, st, created, decided) => Number((await prop.run(ids[c], svc, "Escopo de exemplo", v, day(30), day(10), st, day(created), decided === null ? null : day(decided))).lastInsertRowid);
    const p1 = await mk(0, "E-commerce", 480000, "aprovada", -40, -38);
    const p2 = await mk(1, "Landing page", 160000, "aprovada", -20, -18);
    const p3 = await mk(2, "Site institucional", 260000, "aprovada", -9, -6);
    await mk(3, "Landing page", 140000, "enviada", -4, null);
    await mk(4, "Sistema personalizado", 900000, "enviada", -2, null);
    await mk(0, "Manutenção e suporte", 15000, "recusada", -30, -25);
    await mk(2, "Landing page", 120000, "rascunho", -1, null);
    await mk(1, "E-commerce", 420000, "expirada", -60, null);

    const proj = d.prepare("INSERT INTO projects (proposal_id, client_id, name, service, scope, stage, deadline, owner, progress, checklist, created_at, demo) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)");
    const hist = d.prepare("INSERT INTO project_history (project_id, text) VALUES (?,?)");
    const mkp = async (pid, c, name, svc, stage, dl, prog, created) => {
      const id = Number((await proj.run(pid, ids[c], name, svc, "Escopo de exemplo", stage, day(dl), "Gabriel Ribeiro Silva", prog,
        JSON.stringify([{ text: "Briefing aprovado", done: true }, { text: "Layout aprovado", done: prog > 40 }, { text: "Publicação", done: false }]), day(created))).lastInsertRowid);
      await hist.run(id, "Projeto criado (exemplo)");
      return id;
    };
    const j1 = await mkp(p1, 0, "Loja Doce Mel", "E-commerce", "Desenvolvimento", 12, 60, -38);
    const j2 = await mkp(p2, 1, "Landing RT Esportes", "Landing page", "Design", 9, 30, -18);
    const j3 = await mkp(p3, 2, "Site Studio Prado", "Site institucional", "Aguardando materiais", 25, 10, -6);

    const inst = d.prepare("INSERT INTO installments (proposal_id, project_id, client_id, label, amount, due_date, demo) VALUES (?,?,?,?,?,?,1)");
    const pay = d.prepare("INSERT INTO payments (installment_id, client_id, project_id, amount, paid_at, source, note, demo) VALUES (?,?,?,?,?,'manual','Exemplo',1)");
    const split = async (p, j, c, total, dates) => {
      const out = [];
      for (const [i, dt] of dates.entries()) out.push(Number((await inst.run(p, j, ids[c], i === 0 ? "Entrada" : `Parcela ${i}`, total / dates.length, day(dt))).lastInsertRowid));
      return out;
    };
    const [a1, a2] = await split(p1, j1, 0, 480000, [-38, -8, 22]);
    await pay.run(a1, ids[0], j1, 160000, day(-38)); await pay.run(a2, ids[0], j1, 160000, day(-7));
    const [b1, b2] = await split(p2, j2, 1, 160000, [-18, -3]);
    await pay.run(b1, ids[1], j2, 80000, day(-18)); await pay.run(b2, ids[1], j2, 30000, day(-1)); // parcial, vencida
    const [c1] = await split(p3, j3, 2, 260000, [-6, 20]);
    await pay.run(c1, ids[2], j3, 130000, day(-5));

    await d.prepare("INSERT INTO expenses (project_id, description, amount, date, demo) VALUES (?,?,?,?,1)").run(j1, "Domínio e plugins (exemplo)", 25000, day(-30));
    const rec = d.prepare("INSERT INTO recurring (client_id, name, kind, amount, period, status, next_due, demo) VALUES (?,?,?,?,?,?,?,1)");
    await rec.run(ids[0], "Hospedagem Doce Mel", "Hospedagem", 6000, "mensal", "ativo", day(8));
    await rec.run(ids[1], "Suporte RT Esportes", "Suporte", 15000, "mensal", "ativo", day(14));
    await rec.run(ids[3], "Manutenção anual", "Manutenção", 120000, "anual", "pausado", day(90));
  });
  return true;
}

export async function removeDemo() {
  // Remove tudo que pertence a clientes de exemplo (inclui projetos e parcelas gerados ao aprovar propostas de exemplo)
  const demoClients = "(SELECT id FROM clients WHERE demo=1)";
  await tx(async (d) => {
    await d.exec(`DELETE FROM payments WHERE demo=1 OR client_id IN ${demoClients};
DELETE FROM expenses WHERE demo=1 OR project_id IN (SELECT id FROM projects WHERE client_id IN ${demoClients});
DELETE FROM installments WHERE demo=1 OR client_id IN ${demoClients};
DELETE FROM recurring WHERE demo=1 OR client_id IN ${demoClients};
DELETE FROM project_history WHERE project_id IN (SELECT id FROM projects WHERE demo=1 OR client_id IN ${demoClients});
DELETE FROM projects WHERE demo=1 OR client_id IN ${demoClients};
DELETE FROM proposals WHERE demo=1 OR client_id IN ${demoClients};
DELETE FROM clients WHERE demo=1;`);
  });
}
