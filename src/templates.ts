import { addDays, todayISO } from "./lib";

export type Template = {
  id: number; name: string; service: string; scope: string | null; deliverables: string | null; exclusions: string | null;
  revisions: number; deadline_days: number; validity_days: number; payment_terms: string | null; price: number; active: number;
};

const list = (s: string | null) => (s ?? "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => `- ${l}`).join("\n");

/** Texto do escopo da proposta montado a partir do modelo (todas as seções ficam registradas na própria proposta). */
export function scopeText(t: Template) {
  const parts: string[] = [];
  if (t.scope) parts.push(`ESCOPO\n${t.scope}`);
  if (t.deliverables) parts.push(`ENTREGÁVEIS\n${list(t.deliverables)}`);
  if (t.exclusions) parts.push(`NÃO ESTÁ INCLUÍDO\n${list(t.exclusions)}`);
  parts.push(`REVISÕES\n${t.revisions === 0 ? "Sem rodadas de revisão incluídas." : `${t.revisions} rodada(s) de revisão inclusa(s).`}`);
  parts.push(`PRAZO\n${t.deadline_days} dia(s) corridos a partir da aprovação e do envio dos materiais.`);
  if (t.payment_terms) parts.push(`PAGAMENTO\n${t.payment_terms}`);
  return parts.join("\n\n");
}

/** Campos da proposta preenchidos por um modelo; o prazo e a validade contam a partir de hoje. */
export const fromTemplate = (t: Template) => ({
  service: t.service,
  value: t.price,
  scope: scopeText(t),
  deadline: addDays(todayISO(), t.deadline_days),
  valid_until: addDays(todayISO(), t.validity_days),
});
