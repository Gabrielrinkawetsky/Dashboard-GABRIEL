export type Client = { id: number; name: string; company: string | null; email: string | null; phone: string | null; notes: string | null; demo: number };
export type ProposalStatus = "rascunho" | "enviada" | "aprovada" | "recusada" | "expirada";
export type Proposal = { id: number; client_id: number; service: string; scope: string | null; value: number; deadline: string | null; valid_until: string | null; status: ProposalStatus; created_at: string; decided_at: string | null; demo: number };
export type CheckItem = { text: string; done: boolean };
export type Project = { id: number; proposal_id: number | null; client_id: number; name: string | null; service: string; scope: string | null; stage: string; deadline: string | null; owner: string | null; progress: number; checklist: CheckItem[]; notes: string | null; links: string | null; cancelled: number; created_at: string; demo: number };
export type History = { id: number; project_id: number; at: string; text: string };
export type Installment = { id: number; proposal_id: number | null; project_id: number | null; client_id: number; label: string | null; amount: number; due_date: string; demo: number };
export type Payment = { id: number; installment_id: number | null; client_id: number | null; project_id: number | null; amount: number; type: "payment" | "refund"; paid_at: string; source: string; external_id: string | null; note: string | null; created_at: string; demo: number };
export type Expense = { id: number; project_id: number | null; description: string; amount: number; date: string; demo: number };
export type Recurring = { id: number; client_id: number; name: string; kind: string | null; amount: number; period: "mensal" | "trimestral" | "anual"; status: "ativo" | "pausado" | "cancelado"; next_due: string | null; demo: number };
export type Service = { id: number; name: string; default_price: number; active: number };
export type Data = {
  clients: Client[]; services: Service[]; proposals: Proposal[]; projects: Project[]; history: History[];
  installments: Installment[]; payments: Payment[]; expenses: Expense[]; recurring: Recurring[];
  settings: Record<string, string>; integration: { webhookConfigured: boolean; providerConnected: boolean };
};
export const STAGES = ["Briefing", "Aguardando materiais", "Design", "Desenvolvimento", "Revisão", "Entregue"] as const;
