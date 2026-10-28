export const paymentMethodValues = ["TRANSFERENCIA", "MERCADO_PAGO", "MODO"] as const;

export type PaymentMethod = (typeof paymentMethodValues)[number];

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  TRANSFERENCIA: "Transferencia bancaria",
  MERCADO_PAGO: "Mercado Pago",
  MODO: "MODO"
};
