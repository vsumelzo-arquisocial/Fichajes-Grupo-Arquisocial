import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, Empresa } from "../api";

export default function Setup() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [f, setF] = useState({ setupKey: "", email: "", nombre: "", apellidos: "", empresaId: 0, password: "", password2: "" });
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => { api.empresas().then(setEmpresas).catch(() => {}); }, []);
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (f.password !== f.password2) return setError("Las contraseñas no coinciden");
    setEnviando(true);
    try {
      await api.setup({ ...f, empresaId: Number(f.empresaId) });
      setHecho(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error de conexión");
    } finally {
      setEnviando(false);
    }
  }

  if (hecho) {
    return (
      <div className="centrado">
        <div className="tarjeta form-login">
          <h1>Administrador creado</h1>
          <p>Ya puedes iniciar sesión. La clave de configuración se ha invalidado automáticamente.</p>
          <Link className="btn btn-primario" to="/">Ir al inicio de sesión</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="centrado">
      <form className="tarjeta form-login" onSubmit={enviar}>
        <h1>Configuración inicial</h1>
        <p className="sub">Crea el primer usuario administrador.</p>
        <label>Clave de configuración<input type="password" value={f.setupKey} onChange={set("setupKey")} required /></label>
        <label>Email<input type="email" value={f.email} onChange={set("email")} required /></label>
        <div className="fila">
          <label>Nombre<input value={f.nombre} onChange={set("nombre")} required /></label>
          <label>Apellidos<input value={f.apellidos} onChange={set("apellidos")} required /></label>
        </div>
        <label>
          Empresa
          <select value={f.empresaId} onChange={set("empresaId")} required>
            <option value="">Selecciona…</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </label>
        <label>Contraseña<input type="password" autoComplete="new-password" value={f.password} onChange={set("password")} required /></label>
        <label>Repite la contraseña<input type="password" autoComplete="new-password" value={f.password2} onChange={set("password2")} required /></label>
        <p className="nota">Mínimo 10 caracteres, con letras y números.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-primario" disabled={enviando}>Crear administrador</button>
      </form>
    </div>
  );
}
