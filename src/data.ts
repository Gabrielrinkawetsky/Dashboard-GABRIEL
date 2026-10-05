export type Pedido = {
  id: string;
  cliente: string;
  produto: string;
  valor: number;
  status: "Pago" | "Pendente" | "Cancelado";
  data: string; // YYYY-MM-DD
};

const produtos = ["Camiseta", "Boné", "Tênis", "Mochila", "Jaqueta"];
const clientes = ["Ana Souza", "Bruno Lima", "Carla Dias", "Diego Rocha", "Eva Martins", "Filipe Costa"];
const status: Pedido["status"][] = ["Pago", "Pago", "Pago", "Pendente", "Cancelado"];

// Dados de exemplo determinísticos (troque pelos dados reais depois)
export const pedidos: Pedido[] = Array.from({ length: 60 }, (_, i) => {
  const d = new Date(2026, 8, 30 - (i % 30));
  return {
    id: `#${1000 + i}`,
    cliente: clientes[i % clientes.length],
    produto: produtos[(i * 7) % produtos.length],
    valor: 50 + ((i * 37) % 450),
    status: status[(i * 3) % status.length],
    data: d.toISOString().slice(0, 10),
  };
});
