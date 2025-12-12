# 🚀 PROTOCOLO DE ACTIVACIÓN MANUAL (TITANIUM)

¡Atención DevOps! Los archivos de código ya están configurados.
Solo debes ejecutar estos comandos en tu terminal para activar el sistema.

### PASO 1: CREAR BASE DE DATOS
Genera la base de datos en Cloudflare D1.
`npx wrangler d1 create borgptron-db`

### PASO 2: VINCULAR ID (CRÍTICO)
1. Copia el `database_id` que salió en el paso anterior.
2. Abre el archivo `wrangler.toml`.
3. Reemplaza el texto `"REPLACE_WITH_REAL_ID_FROM_BORGACCIONES"` por el ID real.
4. Guarda el archivo.

### PASO 3: MIGRAR TABLAS
Crea las tablas `users` y `jobs` en la nube.
`npx wrangler d1 execute borgptron-db --file=schema.sql`

### PASO 4: SUBIR SECRETOS
Sube tu token de Telegram de forma segura.
`npx wrangler secret put TELEGRAM_BOT_TOKEN`
*(Pega el token cuando te lo pida)*

### PASO 5: DESPLIEGUE FINAL
Sube todo a la red global.
`npx wrangler deploy`

### PASO 6: CONECTAR TELEGRAM
Conecta el webhook (sustituye `<TOKEN>` y `<WORKER_URL>`).
`curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<WORKER_URL>"`
