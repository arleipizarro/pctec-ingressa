# Modelo de Domínio

## Entidades principais

### Identity

Representa uma entidade autenticável. No MVP, pessoas. Futuramente, contas técnicas, serviços e aplicações.

### Profile

Uma identidade pode possuir múltiplos perfis:

- EMPLOYEE
- CUSTOMER
- PARTNER
- SUPPLIER
- SERVICE_ACCOUNT

### Organization

Representa grupos empresariais e empresas.

Tipos iniciais:

- BUSINESS_GROUP
- COMPANY

### Membership

Vínculo de uma identidade com uma organização.

Escopos:

- ORGANIZATION_ONLY
- ORGANIZATION_AND_DESCENDANTS

### Application

Produto ou sistema registrado no ecossistema.

### Credential

Forma de autenticação de uma identidade.

### Session

Sessão autenticada, auditável e revogável.

### Role e Permission

Papéis globais e permissões globais de acesso à plataforma. Permissões operacionais permanecem nos produtos consumidores.
