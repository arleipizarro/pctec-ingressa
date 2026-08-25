import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Escopo do ASSISTENTE de importação (v0.10.x).
 *
 * A diferença em relação ao piloto (`HelpdeskPilotScope`) é uma só, e é
 * a razão de este arquivo existir: lá o escopo é constante do código
 * (`PILOT_USER_IDS = [35, 44]`), aqui o escopo é **seleção explícita de
 * um ADMIN autenticado**, feita na tela e reafirmada no APPLY.
 *
 * Trocar constante por entrada de usuário só é seguro porque a entrada
 * passa por três portas independentes antes de virar escrita:
 *
 *  1. `HelpdeskImportSelection` normaliza e limita o que foi pedido —
 *     nada de lista vazia, nada de id repetido, nada de lote gigante;
 *  2. o planner recusa qualquer registro que a fonte devolva fora da
 *     seleção (`assertOnlySelected`), do mesmo jeito que o piloto
 *     recusa fora do escopo fixo;
 *  3. o `scopeFingerprint` carrega a seleção inteira, então aprovar um
 *     dry-run de 4 usuários nunca autoriza um apply de 40.
 *
 * O controle negativo do piloto continua valendo, com outro nome: o
 * usuário que existe na empresa e NÃO foi marcado precisa estar
 * AUSENTE do lote. Nem CREATE, nem SKIP — ausente, porque um SKIP
 * registrado já seria prova de que o assistente decidiu sobre alguém
 * que ninguém selecionou.
 */
export const WIZARD_SOURCE_SYSTEM = "PCTEC_HELPDESK" as const;
export const WIZARD_SOURCE_USER_ENTITY = "users" as const;
export const WIZARD_SOURCE_CLIENT_ENTITY = "clients" as const;

/**
 * Versão das REGRAS DE NEGÓCIO do assistente.
 *
 * Distinta de `helpdesk-v2` (o piloto) de propósito, e não por
 * incremento cosmético: as regras mudaram de verdade.
 *
 *  1. O destino deixou de ser exigido como entrada. O assistente
 *     resolve a Organization por `OrganizationExternalReference` ativa
 *     e, quando não existe nenhuma, **cria** a empresa — o piloto
 *     exigia que ela já existisse.
 *  2. O escopo deixou de ser constante e passou a ser seleção assinada
 *     pelo ADMIN, presente no `scopeFingerprint`.
 *
 * A consequência é a mesma de sempre e é deliberada: um lote de
 * `helpdesk-v2` não autoriza apply nenhum sob `helpdesk-wizard-v1`, e
 * vice-versa. `ImportBatch.startApply` compara as versões e recusa.
 */
export const WIZARD_MAPPING_RULES_VERSION = "helpdesk-wizard-v1" as const;

/** Papel de usuário EXTERNO no Helpdesk — `admin`/`atendente` não entram. */
export const WIZARD_SOURCE_EXTERNAL_ROLE = "cliente" as const;

export const WIZARD_MEMBERSHIP_PROFILE = "CUSTOMER" as const;
export const WIZARD_APPLICATION_CODE = "PCTEC_HELPDESK" as const;
export const WIZARD_ACCESS_PROFILE = "USER" as const;
export const WIZARD_ORGANIZATION_TYPE_COMPANY = "COMPANY" as const;
export const WIZARD_ORGANIZATION_TYPE_BUSINESS_GROUP = "BUSINESS_GROUP" as const;

/**
 * Teto de usuários por lote.
 *
 * O Helpdesk inteiro tem 170 usuários; a maior empresa tem 15 externos
 * ativos. 200 não é um limite que alguém encoste sem querer — é a trava
 * que impede "selecionar tudo" de virar uma operação de uma tecla,
 * mantendo o lote num tamanho que um humano consegue revisar item a
 * item na tela antes de aprovar.
 */
export const WIZARD_MAX_SELECTED_USERS = 200;

/** Teto de páginas do catálogo — nenhuma tela pede a base inteira. */
export const WIZARD_CATALOG_MAX_LIMIT = 100;
export const WIZARD_CATALOG_DEFAULT_LIMIT = 25;

export class EmptySelectionError extends DomainError {
  public readonly code = "IMPORT_WIZARD_EMPTY_SELECTION";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super(
      "nenhum usuário selecionado. Um lote sem usuário não é uma importação vazia — " +
        "é um pedido que ninguém formulou, e o assistente não abre lote para ele."
    );
  }
}

export class SelectionTooLargeError extends DomainError {
  public readonly code = "IMPORT_WIZARD_SELECTION_TOO_LARGE";
  public readonly classification = "VALIDATION" as const;

  constructor(pedidos: number) {
    super(
      `${pedidos} usuários selecionados excedem o teto de ${WIZARD_MAX_SELECTED_USERS} por lote. ` +
        "Divida em lotes menores — cada um continua revisável antes de aprovar."
    );
  }
}

export class InvalidSourceClientError extends DomainError {
  public readonly code = "IMPORT_WIZARD_SOURCE_CLIENT_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor(valor: unknown) {
    super(`empresa de origem inválida: ${JSON.stringify(valor)}. Esperado o id numérico do cadastro do Helpdesk.`);
  }
}

export class InvalidSourceUserIdError extends DomainError {
  public readonly code = "IMPORT_WIZARD_SOURCE_USER_ID_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor(valor: unknown) {
    super(`usuário de origem inválido na seleção: ${JSON.stringify(valor)}. Esperado id numérico inteiro positivo.`);
  }
}

/**
 * A fonte devolveu alguém que a seleção não pediu.
 *
 * Herdeiro direto de `NegativeControlLeakError` do piloto, e pela mesma
 * razão: a presença do registro já significa que a leitura saiu do
 * combinado. Continuar produziria decisão sobre uma pessoa que nenhum
 * ADMIN marcou na tela.
 */
export class UnselectedSourceUserLeakError extends DomainError {
  public readonly code = "IMPORT_WIZARD_UNSELECTED_USER_LEAK";
  public readonly classification = "VALIDATION" as const;

  constructor(legacyIds: readonly number[]) {
    super(
      `usuário(s) fora da seleção devolvido(s) pela fonte: ${legacyIds.join(", ")}. ` +
        "Nenhuma decisão foi tomada sobre eles e a execução para aqui."
    );
  }
}

export class SelectedSourceUserMissingError extends DomainError {
  public readonly code = "IMPORT_WIZARD_SELECTED_USER_MISSING";
  public readonly classification = "VALIDATION" as const;

  constructor(legacyIds: readonly number[]) {
    super(
      `usuário(s) selecionado(s) ausente(s) na origem: ${legacyIds.join(", ")}. ` +
        "O lote não é aberto com seleção incompleta — o cadastro mudou desde que a tela carregou."
    );
  }
}
