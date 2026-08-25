import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api.js";

/**
 * Carregamento de um recurso com os três estados que a tela precisa.
 * Um único lugar para tratar erro de API evita que cada página invente
 * a própria mensagem — e que alguma esqueça de tratar.
 */
export function usarRecurso<T>(carregar: () => Promise<T>, dependencias: readonly unknown[]): {
  dados: T | null;
  carregando: boolean;
  erro: string | null;
  recarregar: () => void;
} {
  const [dados, setDados] = useState<T | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [gatilho, setGatilho] = useState(0);

  const executar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setDados(await carregar());
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Falha inesperada ao carregar.");
      setDados(null);
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencias, gatilho]);

  useEffect(() => {
    void executar();
  }, [executar]);

  return { dados, carregando, erro, recarregar: () => setGatilho((v) => v + 1) };
}
