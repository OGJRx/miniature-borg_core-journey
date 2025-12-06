# Acciones Manuales para BORGPTRON-CORE MVP 0.1

Esta es una lista de verificación de los pasos manuales necesarios para desplegar y configurar el ecosistema del bot "BORGPTRON-CORE". Siga estas instrucciones cuidadosamente después de que el repositorio haya sido inicializado.

---

### 1. Configuración de la Base de Datos en Google Sheets

El bot utiliza Google Sheets como su base de datos. Es crucial que la estructura coincida exactamente con lo que espera el script de Google Apps.

**A. Crear el Documento de Google Sheets:**
1.  Vaya a [sheets.google.com](https://sheets.google.com) y cree una nueva hoja de cálculo en blanco.
2.  Cambie el nombre del documento a **"Workshop Database"**.

**B. Crear y Configurar la Pestaña `JOBS`:**
1.  Renombre la primera pestaña (por defecto, "Hoja 1") a **`JOBS`**.
2.  En la primera fila (fila 1), ingrese los siguientes encabezados, cada uno en una celda separada de izquierda a derecha, exactamente como se muestra:
    -   `ID`
    -   `chat_id`
    -   `client_name`
    -   `vehicle_info`
    -   `status`
    -   `notes`
    -   `progress`
    -   `is_lead`
    -   `created_at`

**C. Crear y Configurar la Pestaña `SESSIONS`:**
1.  Haga clic en el icono `+` en la parte inferior izquierda para agregar una nueva pestaña.
2.  Renombre esta nueva pestaña a **`SESSIONS`**.
3.  En la primera fila (fila 1) de la pestaña `SESSIONS`, ingrese los siguientes encabezados:
    -   `user_id`
    -   `current_step`
    -   `temp_data`

---

### 2. Despliegue del Script de Google Apps (Capa de Base de Datos)

Este script actúa como el middleware seguro entre su bot de Cloudflare y la base de datos de Google Sheets.

1.  Abra su documento "Workshop Database".
2.  Vaya a **Extensiones -> Apps Script**.
3.  Borre cualquier código existente en el editor.
4.  Copie el contenido completo del archivo `db/Code.gs` de este repositorio y péguelo en el editor de Apps Script.
5.  **Establecer su Clave de API Secreta:**
    -   Dentro del script, localice la línea: `const API_KEY = 'YOUR_GAS_API_KEY_SECRET';`
    -   Reemplace `'YOUR_GAS_API_KEY_SECRET'` con una contraseña segura y única. **Guarde esta clave**, la necesitará en el siguiente paso.
6.  **Guardar y Desplegar:**
    -   Haga clic en el icono de guardar 💾.
    -   Haga clic en el botón azul **"Desplegar"** y seleccione **"Nuevo Despliegue"**.
    -   En la ventana de configuración:
        -   **Ejecutar como:** `Yo` (su cuenta de Google).
        -   **Quién tiene acceso:** `Cualquier persona, incluso anónima`.
    -   Haga clic en **"Desplegar"**.
    -   **Autorice los permisos** si se le solicita.
    -   Copie la **"URL de la aplicación web"** resultante. La necesitará para los secretos del Worker.

---

### 3. Configuración de los Secretos del Cloudflare Worker

Su Worker de Cloudflare necesita acceso seguro a las APIs y variables de entorno. Utilice la CLI de Wrangler para configurarlos.

Abra su terminal en la raíz del proyecto y ejecute los siguientes comandos, reemplazando los valores de ejemplo con sus propios datos:

```bash
# 1. Token de su Bot de Telegram (obtenido de @BotFather)
wrangler secret put TELEGRAM_BOT_TOKEN

# 2. URL de su Aplicación Web de Google Apps Script (del paso anterior)
wrangler secret put GAS_API_URL

# 3. Su Clave de API Secreta de Google Apps Script (la que estableció en el script)
wrangler secret put GAS_API_KEY

# 4. ID del Grupo de Telegram para Notificaciones del Staff
wrangler secret put STAFF_GROUP_ID

# 5. Lista de IDs de Usuarios del Staff (separados por comas)
wrangler secret put STAFF_IDS

# 6. URL de Producción de su Worker (una vez desplegado)
wrangler secret put PRODUCTION_HOST_URL
```

---

### 4. Configuración del Webhook y Despliegue Final

1.  **Instalar Dependencias:**
    -   Si aún no lo ha hecho, ejecute `npm install` en su terminal.

2.  **Desplegar el Worker:**
    -   Ejecute el comando `wrangler deploy`. Esto subirá su bot a la red de Cloudflare y le dará la URL de producción (la que usó para `PRODUCTION_HOST_URL`).

3.  **Establecer el Webhook de Telegram:**
    -   El script `set-webhook` en `package.json` está diseñado para automatizar esto. Asegúrese de que el archivo `scripts/set-webhook.ts` exista y esté configurado correctamente con la URL de su worker, luego ejecute:
      ```bash
      npm run set-webhook
      ```

¡Su bot ahora debería estar en vivo y operativo!
