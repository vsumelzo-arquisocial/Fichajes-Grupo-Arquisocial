import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { api, Usuario } from "./api";

interface Ctx {
  usuario: Usuario | null;
  cargando: boolean;
  refrescar: () => Promise<void>;
  setUsuario: (u: Usuario | null) => void;
  salir: () => Promise<void>;
}

const SesionCtx = createContext<Ctx>(null!);

export function SesionProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);

  const refrescar = useCallback(async () => {
    try {
      const r = await api.me();
      setUsuario(r.usuario);
    } catch {
      setUsuario(null);
    } finally {
      setCargando(false);
    }
  }, []);

  const salir = useCallback(async () => {
    try { await api.logout(); } finally { setUsuario(null); }
  }, []);

  useEffect(() => { refrescar(); }, [refrescar]);

  return <SesionCtx.Provider value={{ usuario, cargando, refrescar, setUsuario, salir }}>{children}</SesionCtx.Provider>;
}

export const useSesion = () => useContext(SesionCtx);
