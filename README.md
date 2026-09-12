# Servidor de Licencias — Formulario COD

Servidor propio (del proveedor) que **genera y valida las llaves de licencia**
del producto Formulario COD. Corre gratis en Cloudflare.

> Esto lo instalas **una sola vez, tú** (el vendedor). No es para los compradores.

## Instalar (1 clic)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/colombiagloz-prog/cod-licencias)

Al hacer clic, Cloudflare crea el servidor y su almacén de datos, y te pide **un
solo valor**:

| Casilla | Qué poner |
|---|---|
| `LICENSE_ADMIN_SECRET` 🔒 | Una **contraseña que inventas tú** (larga y difícil). Es la llave para entrar a tu panel y generar licencias. **No la compartas.** |

Cuando termine, Cloudflare te da la **dirección de tu servidor** (algo como
`https://cod-licencias.TU-CUENTA.workers.dev`). **Guárdala** — se necesita para
conectar el producto al candado.

## Usar

- **Generar una llave al vender:** abre `https://TU-SERVIDOR.workers.dev/admin`,
  entra con tu `LICENSE_ADMIN_SECRET`, escribe el nombre del comprador y dale
  **"Generar llave"**. Copia la llave y entrégasela al comprador.
- **Ver / revocar llaves:** en el mismo panel ves todas, su estado (activa /
  vencida / revocada) y a qué tienda quedó amarrada cada una.

## Cómo funciona el candado

- Cada llave se **amarra a UNA tienda** en su primera activación (una llave
  robada no sirve en otra tienda).
- La llave da **3 meses** de actualizaciones (configurable al generarla).
  Pasados los 3 meses, el producto del comprador **sigue funcionando** — solo
  deja de contar como "con actualizaciones".
- Una llave **revocada** o inexistente hace que ese formulario **no cree
  pedidos**.
