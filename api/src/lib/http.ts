import { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { usuarioDeSesion, UsuarioSesion, Rol } from "./auth";

export const json = (status: number, body: unknown, extra: Partial<HttpResponseInit> = {}): HttpResponseInit => ({
  status,
  jsonBody: body,
  headers: { "Cache-Control": "no-store" },
  ...extra,
});

export const error = (status: number, mensaje: string) => json(status, { error: mensaje });

export async function leerJson<T = any>(req: HttpRequest): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

/** Protección CSRF adicional a SameSite=Strict: las peticiones que modifican datos deben llevar esta cabecera. */
function cabeceraCsrfOk(req: HttpRequest): boolean {
  if (req.method === "GET") return true;
  return req.headers.get("x-requested-with") === "fichajes";
}

type Handler = (req: HttpRequest, ctx: InvocationContext, usuario: UsuarioSesion) => Promise<HttpResponseInit>;

interface Opciones {
  roles?: Rol[];
  permitirCambioPendiente?: boolean;
}

/** Envuelve un handler exigiendo sesión válida (y rol si se indica). */
export function conSesion(handler: Handler, opts: Opciones = {}) {
  return async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      if (!cabeceraCsrfOk(req)) return error(403, "Petición no permitida");
      const usuario = await usuarioDeSesion(req);
      if (!usuario) return error(401, "Sesión no válida o caducada");
      if (usuario.debeCambiarPassword && !opts.permitirCambioPendiente) {
        return error(403, "Debes cambiar tu contraseña antes de continuar");
      }
      if (opts.roles && !opts.roles.includes(usuario.rol)) return error(403, "No tienes permisos para esta acción");
      return await handler(req, ctx, usuario);
    } catch (e: any) {
      ctx.error(e);
      return error(500, "Error interno");
    }
  };
}

/** Envuelve un handler público (sin sesión) con control de errores y CSRF. */
export function publico(handler: (req: HttpRequest, ctx: InvocationContext) => Promise<HttpResponseInit>) {
  return async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      if (!cabeceraCsrfOk(req)) return error(403, "Petición no permitida");
      return await handler(req, ctx);
    } catch (e: any) {
      ctx.error(e);
      return error(500, "Error interno");
    }
  };
}
