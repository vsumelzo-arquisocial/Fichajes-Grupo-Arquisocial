# Fichajes · Grupo Arquisocial

Aplicación web de registro de jornada. Usuarios propios (email de cualquier dominio + contraseña), sin cuenta de Microsoft.

## Estructura
| Carpeta | Contenido |
|---|---|
| `web/` | Frontend React + Vite (TypeScript) |
| `api/` | Azure Functions v4 Node 20 (TypeScript) — API `/api/*` |
| `db/`  | Scripts SQL (ejecutar en orden) |
| `azure-pipelines.yml` | CI/CD Azure DevOps → Static Web Apps |

## Infraestructura
| | Pruebas | Producción |
|---|---|---|
| Static Web App | swa-fichajes-test (https://calm-sky-057af2003.2.azurestaticapps.net) | swa-fichajes-prod (https://mango-sea-0e61d6703.2.azurestaticapps.net) |
| SQL | sql-fichajes-test-neu / sqldb-fichajes-test | sql-fichajes-prod-neu / sqldb-fichajes-prod |
| Rama | `develop` | `main` |

## Configuración de la Static Web App (Settings > Environment variables)
| Variable | Valor |
|---|---|
| `SQL_CONNECTION_STRING` | `Server=tcp:<servidor>.database.windows.net,1433;Database=<bd>;User ID=app_fichajes;Password=<...>;Encrypt=true;TrustServerCertificate=false;Connection Timeout=60;` |
| `JWT_SECRET` | Cadena aleatoria ≥ 64 caracteres (distinta por entorno) |
| `SETUP_KEY` | Clave temporal para crear el primer admin. **Eliminar tras usarla.** |
| `TZ_APP` | `Europe/Madrid` |

## Desarrollo local
```bash
cd api && cp local.settings.example.json local.settings.json   # rellenar valores
npm install && npm start                                        # requiere Azure Functions Core Tools v4
cd ../web && npm install && npm run dev                         # http://localhost:5173 (proxy /api -> 7071)
```

## Seguridad
- Contraseñas con bcrypt (coste 12), política mínima 10 caracteres con letras y números.
- Bloqueo 15 min tras 5 intentos fallidos.
- Sesión JWT en cookie HttpOnly + Secure + SameSite=Strict (10 h), revalidada contra BD en cada petición (desactivar usuario o cambiar contraseña invalida sesiones).
- Cabecera anti-CSRF `X-Requested-With: fichajes` en peticiones de escritura.
- Fichajes y auditoría en tablas **LEDGER append-only** (no se pueden modificar ni borrar). Hora tomada del servidor (UTC).
- Usuario SQL `app_fichajes` con permisos mínimos.

## Notas
- La BD serverless gratuita se auto-pausa: la primera petición tras la pausa puede tardar hasta ~1 min (la API reintenta).
- Las rutas de Functions no pueden empezar por `admin` (reservado), por eso la gestión está en `/api/gestion/*`.

## Despliegue manual desde Windows (sin pipeline)
```powershell
# Desde la carpeta raíz del proyecto
powershell -ExecutionPolicy Bypass -File .\scripts\desplegar.ps1 -Entorno test     # primera vez: configura variables y despliega
powershell -ExecutionPolicy Bypass -File .\scripts\desplegar.ps1 -Entorno test -SoloDesplegar
powershell -ExecutionPolicy Bypass -File .\scripts\desplegar.ps1 -Entorno test -QuitarSetupKey
powershell -ExecutionPolicy Bypass -File .\scripts\subir-repo.ps1                   # sube el código a Azure DevOps
```
