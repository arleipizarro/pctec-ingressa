import { describe, expect, it } from "vitest";

import { BootstrapFirstApplicationAccessService } from "../modules/application/application/BootstrapFirstApplicationAccessService.js";
import {
  ApplicationAccessBootstrapAlreadyCompletedError,
  FoundationalIdentityAmbiguousError
} from "../modules/application/application/errors/ApplicationAccessBootstrapErrors.js";
import { IdentityNotFoundForAccessError } from "../modules/application/domain/errors/ApplicationErrors.js";
import { MariaDbApplicationRepository } from "../modules/application/infrastructure/persistence/MariaDbApplicationRepository.js";
import { MariaDbApplicationAccessRepository } from "../modules/application/infrastructure/persistence/MariaDbApplicationAccessRepository.js";
import {
  FakeAdminAccessConnection,
  FakeAdminAccessConnectionPool
} from "../modules/application/tests/FakeAdminAccessConnection.js";

import { BootstrapFirstCredentialService } from "../modules/security/application/BootstrapFirstCredentialService.js";
import {
  CredentialBootstrapAlreadyCompletedError,
  CredentialIdentityNotFoundationalAdminError
} from "../modules/security/application/errors/CredentialBootstrapErrors.js";
import { IdentityNotFoundForCredentialError } from "../modules/security/domain/errors/CredentialErrors.js";
import { MariaDbCredentialRepository } from "../modules/security/infrastructure/persistence/MariaDbCredentialRepository.js";
import {
  FakeCredentialConnection,
  FakeCredentialConnectionPool
} from "../modules/security/tests/FakeCredentialConnection.js";
import { FakePasswordHasher } from "../modules/security/tests/FakePasswordHasher.js";

import { MariaDbIdentityRepository } from "../modules/identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbAuditEventRepository } from "../modules/audit/infrastructure/MariaDbAuditEventRepository.js";

/**
 * Prova de CADEIA do bootstrap fundacional — ADR-027, emenda v1.0.
 *
 * `productionBootstrapGuard` responde "esta execução pode acontecer
 * aqui e agora?". Este arquivo responde a outra pergunta, que a guarda
 * não alcança: **"os três passos formam uma corrente, ou são três
 * escritas independentes que por acaso costumam acontecer em ordem?"**
 *
 * A distinção importa porque o modo de falha mais perigoso do bootstrap
 * não é o comando rodado no ambiente errado — é o comando rodado no
 * ambiente CERTO com o `publicId` errado. Nenhuma cerimônia pega isso;
 * só um vínculo verificado no serviço.
 *
 * Nada aqui abre rede ou banco: as duas conexões são fakes que modelam
 * o SQL real dos repositórios.
 */

const IDENTITY_FUNDACIONAL = "11111111-1111-4111-8111-111111111111";
const OUTRA_IDENTITY = "22222222-2222-4222-8222-222222222222";
const SENHA_VALIDA = "S3nh4-Fundacional-Muito-Longa";

function servicoDeAcessoAdmin(connection: FakeAdminAccessConnection): BootstrapFirstApplicationAccessService {
  return new BootstrapFirstApplicationAccessService(
    new FakeAdminAccessConnectionPool(() => connection),
    (conn) => new MariaDbApplicationRepository(conn),
    (conn) => new MariaDbIdentityRepository(conn),
    (conn) => new MariaDbApplicationAccessRepository(conn),
    (conn) => new MariaDbAuditEventRepository(conn)
  );
}

function servicoDeCredencial(connection: FakeCredentialConnection): BootstrapFirstCredentialService {
  return new BootstrapFirstCredentialService(
    new FakeCredentialConnectionPool(() => connection),
    (conn) => new MariaDbCredentialRepository(conn),
    (conn) => new MariaDbIdentityRepository(conn),
    (conn) => new MariaDbAuditEventRepository(conn),
    new FakePasswordHasher(connection.timeline),
    (conn) => new MariaDbApplicationRepository(conn),
    (conn) => new MariaDbApplicationAccessRepository(conn)
  );
}

function houveEscrita(connection: { calls: Array<{ sql: string }> }, tabela: string): boolean {
  return connection.calls.some((chamada) => {
    const sql = chamada.sql.trim().toUpperCase();
    return (
      (sql.startsWith("INSERT INTO") || sql.startsWith("UPDATE")) && sql.includes(tabela.toUpperCase())
    );
  });
}

describe("Passo 2 — first-admin-access só promove A Identity fundacional", () => {
  it("aceita quando o diretório tem exatamente uma Identity", async () => {
    const connection = new FakeAdminAccessConnection();
    connection.identityCount = 1;

    const resultado = await servicoDeAcessoAdmin(connection).execute({
      identityPublicId: IDENTITY_FUNDACIONAL
    });

    expect(resultado.accessProfile).toBe("ADMIN");
    expect(houveEscrita(connection, "application_accesses")).toBe(true);
  });

  it.each([2, 3, 17])(
    "RECUSA quando existem %i Identities — não há 'a Identity fundacional' a promover",
    async (quantidade) => {
      const connection = new FakeAdminAccessConnection();
      connection.identityCount = quantidade;

      await expect(
        servicoDeAcessoAdmin(connection).execute({ identityPublicId: IDENTITY_FUNDACIONAL })
      ).rejects.toBeInstanceOf(FoundationalIdentityAmbiguousError);

      // A recusa acontece ANTES de qualquer escrita, e a transação é desfeita.
      expect(houveEscrita(connection, "application_accesses")).toBe(false);
      expect(connection.rollbackCallCount).toBe(1);
      expect(connection.commitCallCount).toBe(0);
    }
  );

  it("com duas Identities, nem sequer a Identity correta é promovida — a ambiguidade bloqueia as duas", async () => {
    for (const alvo of [IDENTITY_FUNDACIONAL, OUTRA_IDENTITY]) {
      const connection = new FakeAdminAccessConnection();
      connection.identityCount = 2;

      await expect(servicoDeAcessoAdmin(connection).execute({ identityPublicId: alvo })).rejects.toBeInstanceOf(
        FoundationalIdentityAmbiguousError
      );
    }
  });

  it("RECUSA Identity inexistente, mesmo com o diretório em estado válido", async () => {
    const connection = new FakeAdminAccessConnection();
    connection.identityExists = false;

    await expect(
      servicoDeAcessoAdmin(connection).execute({ identityPublicId: OUTRA_IDENTITY })
    ).rejects.toBeInstanceOf(IdentityNotFoundForAccessError);
  });

  it("RECUSA um segundo ADMIN — o guard global vale para qualquer Identity", async () => {
    const connection = new FakeAdminAccessConnection();
    connection.adminAlreadyGrantedForApplication = true;

    await expect(
      servicoDeAcessoAdmin(connection).execute({ identityPublicId: IDENTITY_FUNDACIONAL })
    ).rejects.toBeInstanceOf(ApplicationAccessBootstrapAlreadyCompletedError);
    expect(houveEscrita(connection, "application_accesses")).toBe(false);
  });

  it("a contagem é lida DENTRO da transação e sob o lock — não há janela entre ler e conceder", async () => {
    const connection = new FakeAdminAccessConnection();

    await servicoDeAcessoAdmin(connection).execute({ identityPublicId: IDENTITY_FUNDACIONAL });

    const posLock = connection.timeline.indexOf("GET_LOCK");
    const posBegin = connection.timeline.indexOf("BEGIN");
    const posCount = connection.timeline.indexOf("COUNT_IDENTITIES");
    const posCommit = connection.timeline.indexOf("COMMIT");

    expect(posLock).toBeLessThan(posBegin);
    expect(posBegin).toBeLessThan(posCount);
    expect(posCount).toBeLessThan(posCommit);
  });
});

describe("Passo 3 — first-credential só credencia a Identity do ADMIN fundacional", () => {
  it("aceita a Identity que possui o ADMIN fundacional", async () => {
    const connection = new FakeCredentialConnection();
    connection.identityHasFoundationalAdmin = true;

    const resultado = await servicoDeCredencial(connection).execute({
      identityPublicId: IDENTITY_FUNDACIONAL,
      plainPassword: SENHA_VALIDA,
      plainPasswordConfirmation: SENHA_VALIDA
    });

    expect(resultado.identityPublicId).toBe(IDENTITY_FUNDACIONAL);
    expect(houveEscrita(connection, "credentials")).toBe(true);
  });

  it("RECUSA Identity sem o ADMIN fundacional — nunca cria Credential para outra Identity", async () => {
    const connection = new FakeCredentialConnection();
    connection.identityHasFoundationalAdmin = false;

    await expect(
      servicoDeCredencial(connection).execute({
        identityPublicId: OUTRA_IDENTITY,
        plainPassword: SENHA_VALIDA,
        plainPasswordConfirmation: SENHA_VALIDA
      })
    ).rejects.toBeInstanceOf(CredentialIdentityNotFoundationalAdminError);

    // Este é o ponto: sem este guard, a plataforma nasceria com a senha
    // numa conta sem acesso, e a conta ADMIN sem como entrar.
    expect(houveEscrita(connection, "credentials")).toBe(false);
    expect(houveEscrita(connection, "identities")).toBe(false);
    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.commitCallCount).toBe(0);
  });

  it("RECUSA quando a Application PCTEC_INGRESSA não existe — sem ela não há ADMIN a verificar", async () => {
    const connection = new FakeCredentialConnection();
    connection.ingressaApplicationExists = false;

    await expect(
      servicoDeCredencial(connection).execute({
        identityPublicId: IDENTITY_FUNDACIONAL,
        plainPassword: SENHA_VALIDA,
        plainPasswordConfirmation: SENHA_VALIDA
      })
    ).rejects.toBeInstanceOf(CredentialIdentityNotFoundationalAdminError);
    expect(houveEscrita(connection, "credentials")).toBe(false);
  });

  it("RECUSA Identity inexistente", async () => {
    const connection = new FakeCredentialConnection();
    connection.identityExists = false;

    await expect(
      servicoDeCredencial(connection).execute({
        identityPublicId: OUTRA_IDENTITY,
        plainPassword: SENHA_VALIDA,
        plainPasswordConfirmation: SENHA_VALIDA
      })
    ).rejects.toBeInstanceOf(IdentityNotFoundForCredentialError);
  });

  it("NUNCA substitui uma Credential existente — nem para a própria Identity fundacional", async () => {
    const connection = new FakeCredentialConnection();
    connection.anyCredentialExists = true;
    connection.identityHasFoundationalAdmin = true;

    await expect(
      servicoDeCredencial(connection).execute({
        identityPublicId: IDENTITY_FUNDACIONAL,
        plainPassword: SENHA_VALIDA,
        plainPasswordConfirmation: SENHA_VALIDA
      })
    ).rejects.toBeInstanceOf(CredentialBootstrapAlreadyCompletedError);

    expect(houveEscrita(connection, "credentials")).toBe(false);
    expect(connection.commitCallCount).toBe(0);
  });

  it("o guard global de Credential precede o de vínculo — 'já existe senha' vence 'Identity errada'", async () => {
    const connection = new FakeCredentialConnection();
    connection.anyCredentialExists = true;
    connection.identityHasFoundationalAdmin = false;

    await expect(
      servicoDeCredencial(connection).execute({
        identityPublicId: OUTRA_IDENTITY,
        plainPassword: SENHA_VALIDA,
        plainPasswordConfirmation: SENHA_VALIDA
      })
    ).rejects.toBeInstanceOf(CredentialBootstrapAlreadyCompletedError);
  });

  it("a verificação de vínculo roda DENTRO da transação e sob o lock", async () => {
    const connection = new FakeCredentialConnection();

    await servicoDeCredencial(connection).execute({
      identityPublicId: IDENTITY_FUNDACIONAL,
      plainPassword: SENHA_VALIDA,
      plainPasswordConfirmation: SENHA_VALIDA
    });

    const posLock = connection.timeline.indexOf("GET_LOCK");
    const posBegin = connection.timeline.indexOf("BEGIN");
    const posVinculo = connection.timeline.indexOf("CHECK_FOUNDATIONAL_ADMIN");
    const posCommit = connection.timeline.indexOf("COMMIT");

    expect(posLock).toBeLessThan(posBegin);
    expect(posBegin).toBeLessThan(posVinculo);
    expect(posVinculo).toBeLessThan(posCommit);
  });
});

describe("Retomada após interrupção — cada passo recusa repetir, e só o passo pendente avança", () => {
  it("passo 2 interrompido antes do COMMIT deixa o estado retomável: reexecutar concede", async () => {
    // Primeira tentativa: falha no INSERT de auditoria, depois do INSERT
    // de acesso — o ROLLBACK desfaz tudo.
    const interrompida = new FakeAdminAccessConnection();
    interrompida.failAuditInsert = true;
    await expect(
      servicoDeAcessoAdmin(interrompida).execute({ identityPublicId: IDENTITY_FUNDACIONAL })
    ).rejects.toBeTruthy();
    expect(interrompida.rollbackCallCount).toBe(1);
    expect(interrompida.commitCallCount).toBe(0);

    // Retomada: o estado do banco não avançou, então o mesmo comando conclui.
    const retomada = new FakeAdminAccessConnection();
    const resultado = await servicoDeAcessoAdmin(retomada).execute({
      identityPublicId: IDENTITY_FUNDACIONAL
    });

    expect(resultado.accessProfile).toBe("ADMIN");
    expect(retomada.commitCallCount).toBe(1);
  });

  it("passo 2 já concluído recusa repetir, e o passo 3 é o que avança", async () => {
    const passo2Repetido = new FakeAdminAccessConnection();
    passo2Repetido.adminAlreadyGrantedForApplication = true;
    await expect(
      servicoDeAcessoAdmin(passo2Repetido).execute({ identityPublicId: IDENTITY_FUNDACIONAL })
    ).rejects.toBeInstanceOf(ApplicationAccessBootstrapAlreadyCompletedError);

    const passo3 = new FakeCredentialConnection();
    passo3.identityHasFoundationalAdmin = true;
    const resultado = await servicoDeCredencial(passo3).execute({
      identityPublicId: IDENTITY_FUNDACIONAL,
      plainPassword: SENHA_VALIDA,
      plainPasswordConfirmation: SENHA_VALIDA
    });

    expect(resultado.identityPublicId).toBe(IDENTITY_FUNDACIONAL);
  });

  it("a corrente inteira concluída recusa os dois passos finais — reexecução acidental é inofensiva", async () => {
    const passo2 = new FakeAdminAccessConnection();
    passo2.adminAlreadyGrantedForApplication = true;
    const passo3 = new FakeCredentialConnection();
    passo3.anyCredentialExists = true;

    await expect(
      servicoDeAcessoAdmin(passo2).execute({ identityPublicId: IDENTITY_FUNDACIONAL })
    ).rejects.toBeInstanceOf(ApplicationAccessBootstrapAlreadyCompletedError);
    await expect(
      servicoDeCredencial(passo3).execute({
        identityPublicId: IDENTITY_FUNDACIONAL,
        plainPassword: SENHA_VALIDA,
        plainPasswordConfirmation: SENHA_VALIDA
      })
    ).rejects.toBeInstanceOf(CredentialBootstrapAlreadyCompletedError);

    expect(passo2.commitCallCount).toBe(0);
    expect(passo3.commitCallCount).toBe(0);
  });

  it("passo 3 fora de ordem (sem o passo 2) recusa — a corrente não pode ser pulada", async () => {
    const connection = new FakeCredentialConnection();
    connection.identityHasFoundationalAdmin = false; // passo 2 nunca rodou

    await expect(
      servicoDeCredencial(connection).execute({
        identityPublicId: IDENTITY_FUNDACIONAL,
        plainPassword: SENHA_VALIDA,
        plainPasswordConfirmation: SENHA_VALIDA
      })
    ).rejects.toBeInstanceOf(CredentialIdentityNotFoundationalAdminError);
  });
});
