import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Erros de orquestração do processo de bootstrap da primeira concessão
 * administrativa — paralelo direto de
 * `modules/identity/application/errors/BootstrapErrors.ts` (v0.4.0/ADR-027),
 * mesma distinção entre "já concluído" e "lock indisponível" (concorrência
 * em andamento).
 */

export class ApplicationAccessBootstrapAlreadyCompletedError extends DomainError {
  public readonly code = "APPLICATION_ACCESS_BOOTSTRAP_ALREADY_COMPLETED";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super(
      "A primeira concessão administrativa já foi realizada anteriormente — já existe um ApplicationAccess ADMIN ativo para PCTEC_INGRESSA."
    );
  }
}

export class ApplicationAccessLockNotAcquiredError extends DomainError {
  public readonly code = "APPLICATION_ACCESS_LOCK_NOT_ACQUIRED";
  public readonly classification = "CONFLICT" as const;

  constructor(lockName: string, timeoutSeconds: number) {
    super(
      `Não foi possível adquirir o lock "${lockName}" em ${timeoutSeconds}s — outro processo de bootstrap de acesso administrativo parece estar em execução.`
    );
  }
}

/**
 * Existe mais de uma Identity no diretório — não há "a Identity
 * fundacional" a promover (v1.0, ADR-027 emenda).
 *
 * O guard global de ADMIN acima responde "a raiz administrativa já
 * existe". Este responde a outra pergunta: "qual das Identities é a
 * fundacional?". Quando há mais de uma, essa pergunta não tem resposta
 * derivável — e escolher pela que veio no parâmetro seria transformar um
 * `publicId` digitado à mão na definição de quem manda na plataforma.
 *
 * Na sequência correta do bootstrap o passo 1 acabou de garantir
 * `COUNT(identities) = 0` antes de inserir, então neste ponto o
 * diretório tem exatamente uma. Mais de uma significa que alguém criou
 * Identities por fora — e aí o caminho é a tela administrativa, com um
 * ADMIN que já exista, nunca este CLI.
 */
export class FoundationalIdentityAmbiguousError extends DomainError {
  public readonly code = "FOUNDATIONAL_IDENTITY_AMBIGUOUS";
  public readonly classification = "CONFLICT" as const;

  constructor(identityCount: number) {
    super(
      `O diretório contém ${identityCount} Identities — o bootstrap administrativo só opera sobre a única Identity fundacional. ` +
        "Conceda o acesso pela tela administrativa, com um ADMIN existente."
    );
  }
}
