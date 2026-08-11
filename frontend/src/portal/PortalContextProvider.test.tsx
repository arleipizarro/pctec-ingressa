import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { AuthProvider } from "../auth/AuthContext.js";
import { PortalContextProvider, usePortalContext } from "./PortalContextProvider.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function errorBody(code: string) {
  return { error: { code, message: "erro", correlation_id: null, details: [] } };
}

function meResponse() {
  return jsonResponse(200, { identity: { publicId: "id-1" }, session: { publicId: "s1" } });
}

function StateProbe(): JSX.Element {
  const { state, selectOrganization } = usePortalContext();
  return (
    <div>
      <div data-testid="kind">{state.kind}</div>
      {state.kind === "ready" && (
        <>
          <div data-testid="count">{state.organizations.length}</div>
          <div data-testid="selected">{state.selectedOrganizationPublicId ?? "none"}</div>
          {state.organizations.map((org) => (
            <button key={org.publicId} data-testid={`select-${org.publicId}`} onClick={() => selectOrganization(org.publicId)}>
              selecionar {org.publicId}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

async function renderWithPortal(portalResponse: Response) {
  const fetchMock = vi.fn();
  fetchMock.mockResolvedValueOnce(meResponse()); // bootstrap /me
  fetchMock.mockResolvedValueOnce(portalResponse); // /portal/context
  vi.stubGlobal("fetch", fetchMock);

  render(
    <AuthProvider>
      <PortalContextProvider>
        <StateProbe />
      </PortalContextProvider>
    </AuthProvider>
  );

  return fetchMock;
}

describe("PortalContextProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("D) zero organizations -> state.kind='ready', organizations vazio, NUNCA tratado como erro", async () => {
    await renderWithPortal(jsonResponse(200, { identity: { publicId: "id-1" }, organizations: [] }));

    await waitFor(() => expect(screen.getByTestId("kind")).toHaveTextContent("ready"));
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("E) uma organization -> seleção automática", async () => {
    await renderWithPortal(
      jsonResponse(200, {
        identity: { publicId: "id-1" },
        organizations: [{ publicId: "org-1", type: "COMPANY", legalName: "Empresa Única", tradeName: null }]
      })
    );

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("org-1"));
  });

  it("F) múltiplas organizations -> nenhuma pré-selecionada; seleção manual usa publicId real (L)", async () => {
    await renderWithPortal(
      jsonResponse(200, {
        identity: { publicId: "id-1" },
        organizations: [
          { publicId: "org-1", type: "COMPANY", legalName: "Empresa A", tradeName: null },
          { publicId: "org-2", type: "BUSINESS_GROUP", legalName: "Grupo B", tradeName: null }
        ]
      })
    );

    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));
    expect(screen.getByTestId("selected")).toHaveTextContent("none");

    fireEvent.click(screen.getByTestId("select-org-2"));

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("org-2"));
  });

  it("L) selectOrganization com um publicId que NÃO veio da resposta real é ignorado (nunca aceita ID arbitrário)", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(meResponse());
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        identity: { publicId: "id-1" },
        organizations: [
          { publicId: "org-1", type: "COMPANY", legalName: "Empresa A", tradeName: null },
          { publicId: "org-2", type: "COMPANY", legalName: "Empresa B", tradeName: null }
        ]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <PortalContextProvider>
          <SelectArbitraryProbe />
        </PortalContextProvider>
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("none"));

    fireEvent.click(screen.getByTestId("select-arbitrary"));

    // Nunca muda para o ID arbitrário — permanece "none" (2 orgs, sem
    // seleção automática, e o ID inventado nunca é aceito).
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("none"));
  });

  it("G) 403 APPLICATION_ACCESS_DENIED -> state.kind='access-denied'", async () => {
    await renderWithPortal(jsonResponse(403, errorBody("APPLICATION_ACCESS_DENIED")));

    await waitFor(() => expect(screen.getByTestId("kind")).toHaveTextContent("access-denied"));
  });

  it("I) erro de rede/5xx no /portal/context -> state.kind='error' (nunca 'access-denied' por engano)", async () => {
    await renderWithPortal(jsonResponse(500, errorBody("INTERNAL_ERROR")));

    await waitFor(() => expect(screen.getByTestId("kind")).toHaveTextContent("error"));
  });
});

function SelectArbitraryProbe(): JSX.Element {
  const { state, selectOrganization } = usePortalContext();
  if (state.kind !== "ready") {
    return <div data-testid="kind">{state.kind}</div>;
  }
  return (
    <div>
      <button data-testid="select-arbitrary" onClick={() => selectOrganization("id-que-nunca-existiu")}>
        selecionar arbitrário
      </button>
      <div data-testid="selected">{state.selectedOrganizationPublicId ?? "none"}</div>
    </div>
  );
}
