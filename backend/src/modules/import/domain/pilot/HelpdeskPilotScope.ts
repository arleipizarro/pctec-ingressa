import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Escopo FECHADO da primeira fatia do importador Helpdesk.
 *
 * Os ids não são parâmetro do CLI, e isso é deliberado: enquanto o
 * escopo for uma constante do código, ampliar o piloto exige commit,
 * revisão e PR. Um `--ids` na linha de comando transformaria "importar
 * dois usuários" e "importar a base inteira" na mesma operação, separada
 * apenas pela atenção de quem digita.
 */
export const PILOT_SOURCE_SYSTEM = "PCTEC_HELPDESK" as const;
export const PILOT_SOURCE_ENTITY = "users" as const;
export const PILOT_USER_IDS: readonly number[] = Object.freeze([35, 44]);

/**
 * Usuário 45 — controle negativo.
 *
 * Mesma empresa (`client_id` 75), mesmo papel, também ativo: ele é
 * indistinguível dos dois do piloto por qualquer critério que não seja o
 * escopo explícito. É exatamente por isso que serve de controle — se
 * alguma regra vazar do escopo para "quem parece elegível", é ele quem
 * aparece no lote, e o teste falha.
 *
 * Não existe ação correta para o 45 nesta fatia. Nem CREATE, nem SKIP,
 * nem QUARANTINE: ele precisa estar AUSENTE da trilha, porque um SKIP
 * registrado já seria prova de que o importador o leu.
 */
export const NEGATIVE_CONTROL_USER_ID = 45 as const;

/**
 * Versão das REGRAS DE NEGÓCIO desta fatia — não a versão do código.
 *
 * `helpdesk-v2` (2026-08-25) mudou duas decisões em relação à `v1`:
 *
 *  1. O destino deixou de ser resolvido por razão social e passou a ser
 *     entrada operacional explícita (`--target-organization-public-id`
 *     e `--expected-source-client-id`). Nome de empresa muda; chave de
 *     destino não pode mudar junto.
 *  2. Divergência de cadastro que exigiria atualizar uma Identity virou
 *     QUARANTINE, não mais UPDATE — o apply não sabe executar UPDATE, e
 *     propor o que não se sabe aplicar produz lote impossível de aprovar.
 *
 * A consequência é deliberada: lotes de `helpdesk-v1` não autorizam
 * nenhum apply sob `v2`. `ImportBatch.startApply` compara as versões e
 * recusa — é assim que um lote planejado sob regra antiga fica obsoleto
 * sem que ninguém precise editar a linha dele.
 */
export const PILOT_MAPPING_RULES_VERSION = "helpdesk-v2" as const;
export const PILOT_MEMBERSHIP_PROFILE = "CUSTOMER" as const;
export const PILOT_MEMBERSHIP_SCOPE = "ORGANIZATION_ONLY" as const;
export const PILOT_APPLICATION_CODE = "PCTEC_HELPDESK" as const;
export const PILOT_ACCESS_PROFILE = "USER" as const;
/** Papel de usuário EXTERNO no Helpdesk — `admin`/`atendente` não entram. */
export const PILOT_SOURCE_ROLE = "cliente" as const;

export class OutOfPilotScopeError extends DomainError {
  public readonly code = "IMPORT_PILOT_OUT_OF_SCOPE";
  public readonly classification = "VALIDATION" as const;

  constructor(legacyId: number) {
    super(
      `usuário de origem ${legacyId} está fora do escopo do piloto ` +
        `(${PILOT_USER_IDS.join(", ")}). Nenhuma decisão foi tomada sobre ele.`
    );
  }
}

export class NegativeControlLeakError extends DomainError {
  public readonly code = "IMPORT_PILOT_NEGATIVE_CONTROL_LEAK";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super(
      `usuário ${NEGATIVE_CONTROL_USER_ID} é o controle negativo desta fatia e ` +
        "não pode ser lido, decidido ou registrado. A execução para aqui."
    );
  }
}

export function isInPilotScope(legacyId: number): boolean {
  return PILOT_USER_IDS.includes(legacyId);
}

/**
 * Porta única pela qual todo id passa antes de virar decisão.
 *
 * O controle negativo tem erro próprio: "fora do escopo" e "o controle
 * negativo vazou" são o mesmo sintoma com gravidades diferentes — o
 * segundo significa que a trava desta fatia falhou.
 */
/**
 * Mapeamento de destino do piloto — ENTRADA OPERACIONAL, nunca hardcode.
 *
 * `expectedSourceClientId` (o `clients.id` do Helpdesk) e
 * `targetOrganizationPublicId` (a Organization do Ingressa) são os dois
 * lados de uma associação que ninguém pode deduzir: não existe
 * `OrganizationExternalReference` de `PCTEC_HELPDESK` que a resolva, e
 * casar por nome de empresa transforma um `UPDATE clients SET name` em
 * mudança de quem tem acesso a quê.
 *
 * Quem executa o piloto afirma a associação na linha de comando, e o
 * importador a verifica contra o banco antes de abrir o lote.
 */
export interface PilotTargetMapping {
  readonly expectedSourceClientId: number;
  readonly targetOrganizationPublicId: string;
}

export function assertInPilotScope(legacyId: number): void {
  if (legacyId === NEGATIVE_CONTROL_USER_ID) {
    throw new NegativeControlLeakError();
  }
  if (!isInPilotScope(legacyId)) {
    throw new OutOfPilotScopeError(legacyId);
  }
}
