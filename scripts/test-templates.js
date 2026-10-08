// Testes dos modelos de proposta/contrato (/api/templates).   npm run test:templates
import { startHarness } from "./harness.js";

const { api, t, eq, ok, finish } = await startHarness("dashboard-templates-test-");

await t("T1", "exige login", async () => {
  eq((await api("templates", "GET", undefined, { cookie: null })).status, 401);
  eq((await api("templates", "POST", { name: "x", service: "y" }, { cookie: null })).status, 401);
});
await t("T2", "traz os 4 modelos padrão completos, uma única vez", async () => {
  const r = await api("templates");
  eq(r.status, 200); eq(r.json.length, 4);
  for (const n of ["Landing page", "E-commerce", "Site institucional", "Manutenção mensal"]) ok(r.json.some((x) => x.name === n), n);
  for (const x of r.json) ok(x.scope && x.deliverables && x.exclusions && x.payment_terms && x.price > 0 && x.revisions >= 0 && x.deadline_days > 0, `${x.name} incompleto`);
  eq((await api("templates")).json.length, 4, "segunda leitura não duplica");
});
let created;
await t("T3", "cria, edita e valida um modelo", async () => {
  const r = await api("templates", "POST", { name: "Loja premium", service: "E-commerce", price: 900000, revisions: 4, deadline_days: 45, validity_days: 10, scope: "Escopo", deliverables: "A\nB", exclusions: "C", payment_terms: "30/70" });
  eq(r.status, 201); created = r.json; eq(created.price, 900000); eq(created.active, 1);
  const p = await api(`templates/${created.id}`, "PATCH", { price: 950000, active: 0 });
  eq(p.status, 200); eq(p.json.price, 950000); eq(p.json.active, 0); eq(p.json.name, "Loja premium", "campos não enviados ficam");
  for (const bad of [{ name: "", service: "x" }, { name: "x", service: "y", price: -5 }, { name: "x", service: "y", revisions: 1.5 }, { name: "x", service: "y", deadline_days: 0 }, { name: "x", service: "y", hack: 1 }, { name: "x".repeat(81), service: "y" }])
    eq((await api("templates", "POST", bad)).status, 400, JSON.stringify(bad).slice(0, 40));
  eq((await api(`templates/${created.id}`, "PATCH", {})).status, 400);
  eq((await api("templates/abc", "PATCH", { name: "z" })).status, 404);
  eq((await api("templates/999999", "PATCH", { name: "z" })).status, 404);
});
await t("T4", "apagar não recria os padrões", async () => {
  const all = (await api("templates")).json;
  for (const x of all) eq((await api(`templates/${x.id}`, "DELETE")).status, 200);
  eq((await api(`templates/${all[0].id}`, "DELETE")).status, 404);
  eq((await api("templates")).json.length, 0);
});

await finish();
