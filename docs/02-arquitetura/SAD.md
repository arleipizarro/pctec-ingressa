# Software Architecture Document — PCTEC Ingressa

## 1. Contexto

O Ingressa é uma aplicação independente, com backend, frontend e banco próprios.

## 2. Componentes

```text
Navegador
   |
Nginx / HTTPS
   |
PCTEC Ingressa
   |-- Frontend administrativo e Minha Conta
   |-- API REST versionada
   |-- Serviço de autenticação
   |-- Serviço de diretório
   |-- Serviço de sessões
   |-- Serviço de auditoria
   |
MariaDB: pctec_ingressa
```

## 3. Ingressação

- APIs REST versionadas.
- Eventos de domínio.
- Sincronização periódica como reconciliação.
- Nenhum acesso cruzado entre bancos.

## 4. Fronteiras

O Ingressa é dono de:

- Identities.
- Organizations.
- Memberships.
- Applications.
- Credentials.
- Sessions.
- Acesso global às aplicações.
- Auditoria do próprio domínio.

Cada aplicação é dona das permissões internas de negócio.

## 5. Segurança

- HTTPS obrigatório.
- Senhas com hash resistente.
- Tokens curtos e revogáveis.
- Refresh tokens rotativos.
- Proteção contra brute force.
- Auditoria de alterações críticas.
- Segredos fora do repositório.
- MFA preparado desde o modelo inicial.

## 6. Persistência

Banco dedicado: `pctec_ingressa`.

IDs internos podem ser numéricos; IDs públicos devem ser UUIDs imutáveis.

## 7. Observabilidade

- Logs estruturados.
- Correlation ID.
- Health checks.
- Métricas de autenticação.
- Auditoria separada de logs técnicos.
