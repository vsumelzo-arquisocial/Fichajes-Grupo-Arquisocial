export type Rol = "EMPLEADO" | "RESPONSABLE" | "RRHH" | "ADMIN";
export type TipoFichaje = "ENTRADA" | "SALIDA" | "PAUSA_INICIO" | "PAUSA_FIN";
export type Estado = "FUERA" | "TRABAJANDO" | "EN_PAUSA";

export interface Usuario {
  usuarioId: number;
  email: string;
  nombre: string;
  apellidos: string;
  rol: Rol;
  empresaId: number;
  debeCambiarPassword: boolean;
}

export interface ResumenDia {
  fecha: string;
  minutosTrabajados: number;
  minutosPausa: number;
  abierto: boolean;
  fichajes: { tipo: TipoFichaje; fechaHoraUtc: string }[];
}

export interface EstadoFichaje {
  estado: Estado;
  acciones: TipoFichaje[];
  ultimo: { tipo: TipoFichaje; fechaHoraUtc: string } | null;
  hoy: ResumenDia | null;
}

export interface Empresa { id: number; nombre: string }
export interface Centro { id: number; nombre: string; empresaId: number; empresa: string; activo: boolean }
export interface UsuarioGestion {
  id: number; email: string; nombre: string; apellidos: string;
  empresaId: number; empresa: string; centroId: number | null; centro: string | null;
  rol: Rol; activo: boolean; debeCambiarPassword: boolean; bloqueado: number;
  ultimoAccesoUtc: string | null; creadoUtc: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function llamar<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const res = await fetch(`/api/${ruta}`, {
    method: metodo,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Requested-With": "fichajes" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  let datos: any = null;
  try { datos = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) throw new ApiError(res.status, datos?.error ?? `Error ${res.status}`);
  return datos as T;
}

export const api = {
  setupEstado: () => llamar<{ necesitaSetup: boolean }>("GET", "setup/estado"),
  setup: (d: { setupKey: string; email: string; nombre: string; apellidos: string; empresaId: number; password: string }) => llamar("POST", "setup", d),
  empresas: () => llamar<Empresa[]>("GET", "empresas"),

  login: (email: string, password: string) => llamar<{ usuario: Usuario }>("POST", "auth/login", { email, password }),
  logout: () => llamar("POST", "auth/logout"),
  me: () => llamar<{ usuario: Usuario }>("GET", "auth/me"),
  cambiarPassword: (actual: string, nueva: string) => llamar("POST", "auth/cambiar-password", { actual, nueva }),

  estado: () => llamar<EstadoFichaje>("GET", "fichajes/estado"),
  fichar: (tipo: TipoFichaje) => llamar<{ tipo: TipoFichaje; fechaHoraUtc: string }>("POST", "fichajes", { tipo }),
  historial: (desde: string, hasta: string) =>
    llamar<{ desde: string; hasta: string; dias: ResumenDia[] }>("GET", `fichajes/historial?desde=${desde}&hasta=${hasta}`),

  usuarios: () => llamar<UsuarioGestion[]>("GET", "gestion/usuarios"),
  crearUsuario: (d: any) => llamar<{ id: number }>("POST", "gestion/usuarios", d),
  editarUsuario: (id: number, d: any) => llamar("PUT", `gestion/usuarios/${id}`, d),
  resetPassword: (id: number, passwordTemporal: string) => llamar("POST", `gestion/usuarios/${id}/reset-password`, { passwordTemporal }),
  centros: () => llamar<Centro[]>("GET", "gestion/centros"),
  crearCentro: (nombre: string, empresaId: number) => llamar<{ id: number }>("POST", "gestion/centros", { nombre, empresaId }),
};

/* ---------- utilidades de formato ---------- */
const TZ = "Europe/Madrid";
export const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-ES", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
export const fechaLarga = (yyyyMmDd: string) =>
  new Date(`${yyyyMmDd}T12:00:00Z`).toLocaleDateString("es-ES", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
export const duracion = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
export const hoyLocal = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
export const restarDias = (yyyyMmDd: string, n: number) => {
  const d = new Date(`${yyyyMmDd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

export const ETIQUETA_TIPO: Record<TipoFichaje, string> = {
  ENTRADA: "Entrada",
  SALIDA: "Salida",
  PAUSA_INICIO: "Inicio pausa",
  PAUSA_FIN: "Fin pausa",
};

/** Genera una contraseña temporal que cumple la política (10+ caracteres, letras y números). */
export function generarPasswordTemporal(): string {
  const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const numeros = "23456789";
  const todos = letras + numeros;
  const rnd = (s: string) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  let pw = rnd(letras) + rnd(numeros);
  for (let i = 0; i < 10; i++) pw += rnd(todos);
  return pw.split("").sort(() => crypto.getRandomValues(new Uint8Array(1))[0] - 128).join("");
}
