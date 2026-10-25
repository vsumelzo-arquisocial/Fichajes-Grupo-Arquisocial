import { FormEvent, useState } from "react";
import { api, ApiError } from "../api";
import { useSesion } from "../sesion";

export default function CambiarPassword({ obligatorio = false }: { obligatorio?: boolean }) {
  const { usuario, refrescar, salir } = useSesion();
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [nueva2, setNueva2] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError("");
    setOk(false);
    if (nueva !== nueva2) return setError("Las contraseñas nuevas no coinciden");
    setEnviando(true);
    try {
      await api.cambiarPassword(actual, nueva);
      setActual(""); setNueva(""); setNueva2("");
      setOk(true);
      await refrescar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error de conexión");
    } finally {
      setEnviando(false);
    }
  }

  const form = (
    <form className="tarjeta form-login" onSubmit={enviar}>
      <h1>{obligatorio ? "Establece tu contraseña" : "Mi cuenta"}</h1>
      {usuario && <p className="sub">{usuario.nombre} {usuario.apellidos} · {usuario.email}</p>}
      {obligatorio && <p>Por seguridad, cambia la contraseña temporal antes de continuar.</p>}
      <label>Contraseña actual<input type="password" autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} required /></label>
      <label>Nueva contraseña<input type="password" autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} required /></label>
      <label>Repite la nueva contraseña<input type="password" autoComplete="new-password" value={nueva2} onChange={(e) => setNueva2(e.target.value)} required /></label>
      <p className="nota">Mínimo 10 caracteres, con letras y números. Se cerrarán tus sesiones en otros dispositivos.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {ok && <p className="exito" role="status">Contraseña actualizada.</p>}
      <button className="btn btn-primario" disabled={enviando}>Guardar contraseña</button>
      {obligatorio && <button type="button" className="btn-link" onClick={salir}>Salir</button>}
    </form>
  );

  return obligatorio ? <div className="centrado">{form}</div> : form;
}
