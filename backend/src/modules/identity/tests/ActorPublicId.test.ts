import { describe, it, expect } from "vitest";
import { ActorPublicId, ActorRequiredError } from "../domain/value-objects/ActorPublicId.js";
import { InvalidPublicIdError } from "../domain/value-objects/PublicId.js";

describe("ActorPublicId — marcadores reservados", () => {
  it("system() produz um actor SYSTEM", () => {
    const actor = ActorPublicId.system();
    expect(actor.toString()).toBe("SYSTEM");
    expect(actor.isSystemActor()).toBe(true);
    expect(actor.isBootstrapActor()).toBe(false);
  });

  it("bootstrap() produz um actor BOOTSTRAP", () => {
    const actor = ActorPublicId.bootstrap();
    expect(actor.toString()).toBe("BOOTSTRAP");
    expect(actor.isBootstrapActor()).toBe(true);
    expect(actor.isSystemActor()).toBe(false);
  });
});

describe("ActorPublicId.required — garantia de segurança (revisão crítica v0.5.x)", () => {
  it("aceita 'SYSTEM' vindo de uma string externa (comportamento pré-existente, inalterado)", () => {
    const actor = ActorPublicId.required("SYSTEM");
    expect(actor.isSystemActor()).toBe(true);
  });

  it("REJEITA 'BOOTSTRAP' vindo de uma string externa — nunca reconhecido por required()", () => {
    // Esta é a garantia central da correção: uma primeira versão desta
    // mudança ensinava required() a reconhecer "BOOTSTRAP", o que teria
    // permitido que qualquer entrada externa (header HTTP, corpo de
    // requisição, argv) fosse aceita como esse actor reservado.
    // required("BOOTSTRAP") deve cair no caminho de PublicId.fromString,
    // que rejeita por não ser um UUID válido — NUNCA deve retornar
    // ActorPublicId.bootstrap().
    expect(() => ActorPublicId.required("BOOTSTRAP")).toThrow(InvalidPublicIdError);
  });

  it("uma requisição maliciosa não consegue produzir um actor bootstrap via required()", () => {
    let caught: unknown;
    try {
      ActorPublicId.required("BOOTSTRAP");
    } catch (error) {
      caught = error;
    }
    // Nunca é ActorRequiredError (ausência) nem um ActorPublicId válido
    // com isBootstrapActor()=true — é rejeitado como publicId inválido.
    expect(caught).toBeInstanceOf(InvalidPublicIdError);
    expect(caught).not.toBeInstanceOf(ActorRequiredError);
  });

  it("rejeita ausência de valor com ACTOR_REQUIRED, nunca um default silencioso", () => {
    expect(() => ActorPublicId.required(undefined)).toThrow(ActorRequiredError);
    expect(() => ActorPublicId.required(null)).toThrow(ActorRequiredError);
    expect(() => ActorPublicId.required("")).toThrow(ActorRequiredError);
    expect(() => ActorPublicId.required("   ")).toThrow(ActorRequiredError);
  });

  it("aceita um publicId de Identity humana válido (UUID)", () => {
    const actor = ActorPublicId.required("66231e51-66fb-466d-af4f-ac7b925ca9ec");
    expect(actor.isSystemActor()).toBe(false);
    expect(actor.isBootstrapActor()).toBe(false);
    expect(actor.toString()).toBe("66231e51-66fb-466d-af4f-ac7b925ca9ec");
  });
});

describe("ActorPublicId.bootstrap() — alcance restrito (garantia estrutural)", () => {
  it("bootstrap() não é alcançável por nenhuma função de parsing de string (required/fromIdentityPublicId)", () => {
    // Confirma que a única forma de obter um actor BOOTSTRAP é chamando
    // literalmente ActorPublicId.bootstrap() em código — nunca por
    // qualquer caminho que aceite uma string de entrada.
    const viaRequired = () => ActorPublicId.required("BOOTSTRAP");
    expect(viaRequired).toThrow();

    const direct = ActorPublicId.bootstrap();
    expect(direct.isBootstrapActor()).toBe(true);
  });
});
