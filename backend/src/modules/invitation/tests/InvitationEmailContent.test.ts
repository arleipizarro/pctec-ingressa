import { describe, expect, it } from "vitest";
import {
  comporEmailDeConvite,
  urlDoLogotipo,
  type SmtpInvitationDeliveryOptions
} from "../infrastructure/delivery/SmtpInvitationDelivery.js";
import type { InvitationDeliveryRequest } from "../application/InvitationDelivery.js";

/**
 * Conteúdo do e-mail de convite.
 *
 * O que estes testes protegem não é a estética: é que a mensagem diga a
 * verdade (nunca prometa acesso que a pessoa pode não ter), continue
 * legível sem imagens, e não vaze o token em lugar nenhum além do
 * próprio link.
 */

const BASE = "https://ingressa.exemplo.invalid";
const TOKEN = "token-secreto-de-uso-unico";
const LINK = `${BASE}/convite#${TOKEN}`;

const OPCOES: SmtpInvitationDeliveryOptions = {
  fromLabel: "PCTEC Ingressa",
  supportContact: "a PCTEC"
};

function pedido(sobrescrever: Partial<InvitationDeliveryRequest> = {}): InvitationDeliveryRequest {
  return {
    identityPublicId: "11111111-1111-4111-8111-111111111111",
    fullName: "Fulana de Tal",
    email: "fulana@exemplo.invalid",
    link: LINK,
    // Data fixa: a asserção de validade não pode depender de "hoje".
    expiresAt: new Date("2026-09-05T17:30:00.000Z"),
    ...sobrescrever
  };
}

describe("assunto", () => {
  it("anuncia boas-vindas e a ação, com o rótulo configurado", () => {
    expect(comporEmailDeConvite(pedido(), OPCOES).subject).toBe(
      "Bem-vindo ao PCTEC Ingressa — crie sua senha"
    );
  });
});

describe("saudação — nome só quando confiável", () => {
  it("usa o nome quando ele existe", () => {
    const { html, text } = comporEmailDeConvite(pedido(), OPCOES);
    expect(text).toContain("Olá, Fulana de Tal.");
    expect(html).toContain("Olá, Fulana de Tal.");
  });

  it("sem nome utilizável, cumprimenta sem nome — e NUNCA deriva do e-mail", () => {
    for (const vazio of ["", "   ", "\t\n"]) {
      const { html, text } = comporEmailDeConvite(pedido({ fullName: vazio }), OPCOES);
      expect(text).toContain("Olá.");
      expect(html).toContain("Olá.");
      // O local-part do e-mail não pode virar nome por adivinhação.
      expect(text).not.toContain("fulana@");
      expect(text.toLowerCase()).not.toContain("olá, fulana");
      expect(html.toLowerCase()).not.toContain("olá, fulana");
    }
  });
});

describe("conteúdo e paridade entre HTML e texto puro", () => {
  it("o HTML traz marca, produtos, CTA e assinatura", () => {
    const { html } = comporEmailDeConvite(pedido(), OPCOES);
    expect(html).toContain("a central de acesso às aplicações da PCTEC");
    expect(html).toContain("Portal do Cliente");
    expect(html).toContain("PCTEC Helpdesk");
    expect(html).toContain("Criar minha senha");
    expect(html).toContain("Equipe PCTEC");
  });

  it("o texto puro carrega a MESMA informação — nada só no HTML", () => {
    const { text } = comporEmailDeConvite(pedido(), OPCOES);
    for (const trecho of [
      "a central de acesso às aplicações da PCTEC",
      "Portal do Cliente",
      "PCTEC Helpdesk",
      "Criar minha senha",
      "Este convite é pessoal e não deve ser compartilhado",
      "entre em contato com a PCTEC",
      "Equipe PCTEC",
      LINK
    ]) {
      expect(text).toContain(trecho);
    }
    // Texto puro não pode conter marcação.
    expect(text).not.toContain("<");
  });

  it("nunca promete acesso a todas as aplicações — só ao que o perfil libera", () => {
    const { html, text } = comporEmailDeConvite(pedido(), OPCOES);
    for (const corpo of [html, text]) {
      expect(corpo).toContain("sistemas liberados para o seu perfil");
      expect(corpo).not.toMatch(/acesso a todas as aplica/i);
      expect(corpo).not.toMatch(/você (?:terá|tem) acesso a tod/i);
    }
  });
});

describe("CTA e link", () => {
  it("o botão aponta para o link do convite", () => {
    const { html } = comporEmailDeConvite(pedido(), OPCOES);
    expect(html).toContain(`<a href="${LINK}"`);
    expect(html).toContain(">Criar minha senha</a>");
  });

  it("o token existe SOMENTE dentro do link — nunca solto no corpo", () => {
    const { html, text } = comporEmailDeConvite(pedido(), OPCOES);
    for (const corpo of [html, text]) {
      // Toda ocorrência do token vem precedida do link que o contém.
      const soltas = corpo.split(TOKEN).length - 1;
      const noLink = corpo.split(LINK).length - 1;
      expect(soltas).toBe(noLink);
      expect(soltas).toBeGreaterThan(0);
    }
  });
});

describe("validade real do convite", () => {
  it("mostra a data que veio no pedido, sem inventar", () => {
    const esperada = pedido().expiresAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const { html, text } = comporEmailDeConvite(pedido(), OPCOES);
    expect(text).toContain(esperada);
    expect(html).toContain(esperada);
    expect(text).toContain("só pode ser usado uma vez");
  });

  it("outra expiração produz outra data — o valor não é fixo no template", () => {
    const outro = pedido({ expiresAt: new Date("2027-01-02T10:00:00.000Z") });
    const { text } = comporEmailDeConvite(outro, OPCOES);
    expect(text).toContain(outro.expiresAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }));
  });
});

describe("escaping de conteúdo variável", () => {
  it("nome com HTML é escapado, nunca interpolado cru", () => {
    const { html } = comporEmailDeConvite(
      pedido({ fullName: '<script>alert("x")</script> & <b>Fulana</b>' }),
      OPCOES
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>Fulana</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("link com caracteres especiais é escapado no atributo href", () => {
    const perigoso = `${BASE}/convite?a=1&b=2"><script>x</script>#${TOKEN}`;
    const { html } = comporEmailDeConvite(pedido({ link: perigoso }), OPCOES);
    // O aspas-fecha-atributo não pode sobreviver cru.
    expect(html).not.toContain('"><script>');
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });
});

describe("logotipo — derivado do próprio link, nunca de config paralela", () => {
  it("usa somente a origem: descarta caminho, query, fragmento e credenciais", () => {
    // O link real tem /convite, e o token vive no fragmento.
    expect(urlDoLogotipo(`${BASE}/convite?origem=email&x=1#${TOKEN}`)).toBe(
      `${BASE}/marca/logo-ingressa.png`
    );
    // Credenciais na URL não podem sobreviver no `src` da imagem.
    expect(urlDoLogotipo(`https://usuario:senha@ingressa.exemplo.invalid/convite#${TOKEN}`)).toBe(
      "https://ingressa.exemplo.invalid/marca/logo-ingressa.png"
    );
  });

  it("o token NUNCA aparece na URL do logotipo", () => {
    const logo = urlDoLogotipo(LINK);
    expect(logo).not.toBeNull();
    expect(logo).not.toContain(TOKEN);
    expect(logo).not.toContain("#");
    expect(logo).not.toContain("?");

    // E também não aparece dentro do atributo src no HTML renderizado.
    const { html } = comporEmailDeConvite(pedido(), OPCOES);
    const src = /<img[^>]*src="([^"]*)"/u.exec(html)?.[1] ?? "";
    expect(src).toBe(`${BASE}/marca/logo-ingressa.png`);
    expect(src).not.toContain(TOKEN);
  });

  it("preserva a porta quando ela faz parte da origem", () => {
    expect(urlDoLogotipo(`https://ingressa.exemplo.invalid:8443/convite#${TOKEN}`)).toBe(
      "https://ingressa.exemplo.invalid:8443/marca/logo-ingressa.png"
    );
    expect(urlDoLogotipo("http://localhost:5173/convite#t")).toBe(
      "http://localhost:5173/marca/logo-ingressa.png"
    );
  });

  it("aceita http e https", () => {
    expect(urlDoLogotipo("http://exemplo.invalid/convite#t")).toBe(
      "http://exemplo.invalid/marca/logo-ingressa.png"
    );
    expect(urlDoLogotipo("https://exemplo.invalid/convite#t")).toBe(
      "https://exemplo.invalid/marca/logo-ingressa.png"
    );
  });

  it("esquema não-web, URL relativa ou lixo não viram imagem", () => {
    for (const ruim of [
      "ftp://exemplo.invalid/convite",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "/convite#token",
      "convite",
      "",
      "   ",
      "não-é-url"
    ]) {
      expect(urlDoLogotipo(ruim)).toBeNull();
    }
  });

  it("sem logotipo, marca e CTA continuam legíveis — nenhum <img> quebrado", () => {
    // Link relativo: não dá para derivar origem, então não há imagem.
    const { html } = comporEmailDeConvite(pedido({ link: "/convite#abc" }), OPCOES);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("/marca/logo-ingressa.png");
    // A mensagem continua se identificando e acionável.
    expect(html).toContain("PCTEC Ingressa");
    expect(html).toContain("Central de acesso às aplicações da PCTEC");
    expect(html).toContain("Criar minha senha");
  });

  it("o logo tem alt — leitor de tela e imagem bloqueada mostram a marca", () => {
    expect(comporEmailDeConvite(pedido(), OPCOES).html).toContain('alt="PCTEC Ingressa"');
  });
});

describe("HTML compatível com cliente de e-mail", () => {
  it("usa tabela, CSS inline e largura máxima de 600px", () => {
    const { html } = comporEmailDeConvite(pedido(), OPCOES);
    expect(html).toContain("<table");
    expect(html).toContain("max-width:600px");
    expect(html).toContain('role="presentation"');
    // Nada de <style>, <link> ou classe: cliente de e-mail não garante.
    expect(html).not.toContain("<style");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("class=");
  });

  it("declara charset e viewport para não quebrar acento no celular", () => {
    const { html } = comporEmailDeConvite(pedido(), OPCOES);
    expect(html).toContain('<meta charset="utf-8" />');
    expect(html).toContain("width=device-width");
  });

  it("o destinatário é o e-mail do pedido", () => {
    expect(comporEmailDeConvite(pedido(), OPCOES).to).toBe("fulana@exemplo.invalid");
  });
});
