# ADR-012 — Ativação e demais fluxos sensíveis por Magic Link

## Contexto

Senhas provisórias enviadas por e-mail ou definidas administrativamente
representam um risco de segurança (previsibilidade, reuso, exposição em
canais não seguros) e uma má experiência de primeiro acesso. Além da
ativação, outros fluxos sensíveis (redefinição de senha, confirmação e
troca de e-mail, matrícula de MFA, aprovação de dispositivo) compartilham a
mesma necessidade de uma ação única, expirável e verificável.

## Decisão

Não haverá senha provisória em nenhuma circunstância. Todo fluxo sensível
de credencial é generalizado como `MagicLink`: um link expirável, de uso
único, cujo token nunca é armazenado em texto puro (apenas seu hash).

Tipos previstos: `ACTIVATION`, `PASSWORD_RESET`, `EMAIL_CONFIRMATION`,
`EMAIL_CHANGE`, `MFA_ENROLL`, `DEVICE_APPROVAL`.

Expiração inicial recomendada para `ACTIVATION`: 24 horas. Demais tipos
ficam com prazo Pendente de decisão.

## Consequências

- A primeira credencial de uma identidade só existe como consequência de
  um `MagicLink` do tipo `ACTIVATION` consumido com sucesso.
- Qualquer novo fluxo sensível futuro deve ser modelado como um novo tipo
  de `MagicLink`, não como um mecanismo paralelo.
- O canal de envio do link (e-mail, SMS, outro) não é definido nesta
  decisão — é uma preocupação de infraestrutura de notificação, fora do
  domínio central.

## Status

Proposto — v0.2.0 Domain Foundation.
