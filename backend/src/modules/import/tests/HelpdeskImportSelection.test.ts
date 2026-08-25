import { describe, expect, it } from "vitest";
import { HelpdeskImportSelection } from "../domain/wizard/HelpdeskImportSelection.js";
import {
  EmptySelectionError,
  InvalidSourceClientError,
  InvalidSourceUserIdError,
  SelectionTooLargeError,
  WIZARD_MAX_SELECTED_USERS
} from "../domain/wizard/HelpdeskImportScope.js";
import { CLIENTE_ID, ORG_PUBLIC_ID, GRUPO_PUBLIC_ID } from "./wizardTestSupport.js";

function criar(overrides: Record<string, unknown> = {}) {
  return HelpdeskImportSelection.create({
    sourceClientId: CLIENTE_ID,
    selectedSourceUserIds: [999912, 999911],
    ...overrides
  });
}

describe("seleção do assistente — normalização", () => {
  it("ordena e deduplica os ids, para que a mesma seleção produza sempre o mesmo escopo", () => {
    const a = criar({ selectedSourceUserIds: [999912, 999911, 999912] });
    const b = criar({ selectedSourceUserIds: [999911, 999912] });

    expect(a.getSelectedSourceUserIds()).toEqual([999911, 999912]);
    expect(a.toFingerprintFields()).toEqual(b.toFingerprintFields());
  });

  it("aceita id numérico em texto — a tela envia JSON, não tipos do banco", () => {
    expect(criar({ selectedSourceUserIds: ["999911"], sourceClientId: String(CLIENTE_ID) }).getSelectedSourceUserIds()).toEqual([
      999911
    ]);
  });

  it("recusa seleção vazia — lote sem usuário é pedido que ninguém formulou", () => {
    expect(() => criar({ selectedSourceUserIds: [] })).toThrow(EmptySelectionError);
  });

  it("recusa o que não é lista", () => {
    expect(() => criar({ selectedSourceUserIds: "999911" })).toThrow(InvalidSourceUserIdError);
  });

  it.each([[0], [-1], [1.5], ["abc"], [null], [{}]])("recusa id de usuário inválido: %s", (valor) => {
    expect(() => criar({ selectedSourceUserIds: [valor] })).toThrow(InvalidSourceUserIdError);
  });

  it.each([[0], [-3], ["x"], [undefined]])("recusa empresa de origem inválida: %s", (valor) => {
    expect(() => criar({ sourceClientId: valor })).toThrow(InvalidSourceClientError);
  });

  it("recusa seleção acima do teto do lote", () => {
    const ids = Array.from({ length: WIZARD_MAX_SELECTED_USERS + 1 }, (_, i) => 900000 + i);
    expect(() => criar({ selectedSourceUserIds: ids })).toThrow(SelectionTooLargeError);
  });

  it("aceita exatamente o teto — o limite é inclusivo", () => {
    const ids = Array.from({ length: WIZARD_MAX_SELECTED_USERS }, (_, i) => 900000 + i);
    expect(criar({ selectedSourceUserIds: ids }).getSelectedSourceUserIds()).toHaveLength(
      WIZARD_MAX_SELECTED_USERS
    );
  });

  it("repetir o mesmo id não é caminho para furar o teto", () => {
    const ids = Array.from({ length: WIZARD_MAX_SELECTED_USERS + 50 }, () => 999911);
    expect(criar({ selectedSourceUserIds: ids }).getSelectedSourceUserIds()).toEqual([999911]);
  });
});

describe("seleção do assistente — afirmações opcionais de destino", () => {
  it("guarda os UUIDs afirmados, normalizados em minúsculas", () => {
    const selecao = criar({
      targetOrganizationPublicId: ORG_PUBLIC_ID.toUpperCase(),
      parentBusinessGroupPublicId: GRUPO_PUBLIC_ID
    });
    expect(selecao.getTargetOrganizationPublicId()).toBe(ORG_PUBLIC_ID);
    expect(selecao.getParentBusinessGroupPublicId()).toBe(GRUPO_PUBLIC_ID);
  });

  it("valor malformado vira ausência, nunca segue adiante", () => {
    const selecao = criar({ targetOrganizationPublicId: "não-é-uuid", parentBusinessGroupPublicId: 42 });
    expect(selecao.getTargetOrganizationPublicId()).toBeNull();
    expect(selecao.getParentBusinessGroupPublicId()).toBeNull();
  });

  it("trocar o destino afirmado muda o material do fingerprint", () => {
    const semDestino = criar();
    const comDestino = criar({ targetOrganizationPublicId: ORG_PUBLIC_ID });
    expect(comDestino.toFingerprintFields()).not.toEqual(semDestino.toFingerprintFields());
  });

  it("a seleção inteira entra no fingerprint — quatro usuários não autorizam quarenta", () => {
    const quatro = criar({ selectedSourceUserIds: [1, 2, 3, 4] });
    const cinco = criar({ selectedSourceUserIds: [1, 2, 3, 4, 5] });
    expect(quatro.toFingerprintFields()["selected_source_user_ids"]).toBe("1,2,3,4");
    expect(cinco.toFingerprintFields()).not.toEqual(quatro.toFingerprintFields());
  });

  it("responde se um id pertence à seleção — base da trava do planner", () => {
    const selecao = criar({ selectedSourceUserIds: [999911] });
    expect(selecao.includes(999911)).toBe(true);
    expect(selecao.includes(999945)).toBe(false);
  });
});
