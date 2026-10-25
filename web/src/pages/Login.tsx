import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import { useSesion } from "../sesion";

export default function Login() {
  const { setUsuario } = useSesion();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [necesitaSetup, setNecesitaSetup] = useState(false);

  useEffect(() => {
    api.setupEstado().then((r) => setNecesitaSetup(r.necesitaSetup)).catch(() => {});
  }, []);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError("");
    setEnviando(true);
    try {
      const r = await api.login(email, password);
      setUsuario(r.usuario);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar. Inténtalo de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="centrado">
      <form className="tarjeta form-login" onSubmit={enviar}>
        <div className="marca marca-grande">
          <img src="/favicon.svg" alt="" width={40} height={40} />
          <div>
            <h1>Fichajes</h1>
            <p className="sub">Grupo Arquisocial</p>
          </div>
        </div>
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          Contraseña
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-primario" disabled={enviando}>{enviando ? "Entrando…" : "Entrar"}</button>
        <p className="nota">¿Has olvidado tu contraseña? Contacta con RRHH o con Sistemas.</p>
        {necesitaSetup && <p className="nota"><Link to="/setup">Configuración inicial</Link></p>}
      </form>
    </div>
  );
}
