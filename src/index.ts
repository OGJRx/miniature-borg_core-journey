import { Bot, Context, webhookCallback, InlineKeyboard } from "grammy";

// Definición de tipos para el entorno Cloudflare
interface Env {
  TELEGRAM_BOT_TOKEN: string;
  DB: D1Database; // Conexión nativa a SQLite
  CALENDAR_URL: string; // Tu enlace: https://calendar.app.google/kiKNzNkCxpJiXXdQA
}

// Contexto personalizado
type MyContext = Context & { env: Env };

export default {
  async fetch(request: Request, env: Env, executionContext: ExecutionContext): Promise<Response> {
    const bot = new Bot<MyContext>(env.TELEGRAM_BOT_TOKEN);

    // Middleware para inyectar entorno
    bot.use(async (ctx, next) => {
      ctx.env = env;
      await next();
    });

    // --- COMANDO: /start (PANEL DE CONTROL) ---
    bot.command("start", async (ctx) => {
      const user = ctx.from;
      if (!user) return;

      // 1. Registro asíncrono del usuario (Upsert en D1)
      // Usamos waitUntil para no bloquear la respuesta visual
      const query = `
        INSERT INTO users (telegram_id, first_name, username)
        VALUES (?, ?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET first_name=excluded.first_name
      `;
      ctx.env.DB.prepare(query)
        .bind(user.id, user.first_name, user.username || '')
        .run()
        .catch(console.error); // No esperamos, speed first

      // 2. Renderizar Menú "App-First"
      // Usamos un InlineKeyboard con un botón WebApp para el calendario
      const keyboard = new InlineKeyboard()
        .webApp("yj Agendar Cita", ctx.env.CALENDAR_URL || 'https://calendar.app.google/kiKNzNkCxpJiXXdQA')
        .row()
        .text("🚗 Ver Estado de mi Auto", "check_status")
        .row()
        .url("sos Soporte Humano", "https://t.me/AdminSoporte");

      await ctx.reply(
        `👋 *Hola ${user.first_name}.*\n\n` +
        `Bienvenido al sistema automatizado. \n` +
        `Si necesitas agendar, usa el botón de abajo para abrir el calendario directamente.\n` +
        `Si ya tienes un vehículo con nosotros, consulta su estado.`,
        {
            parse_mode: "Markdown",
            reply_markup: keyboard
        }
      );
    });

    // --- ACCIÓN: CONSULTAR ESTADO (LECTURA D1) ---
    bot.callbackQuery("check_status", async (ctx) => {
        const userId = ctx.from.id;

        // Query SQL directo y optimizado
        const job = await ctx.env.DB.prepare(`
            SELECT id, vehicle_info, status, progress, notes
            FROM jobs
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT 1
        `).bind(userId).first();

        if (!job) {
            return ctx.answerCallbackQuery({
                text: "❌ No tienes vehículos registrados en taller.",
                show_alert: true
            });
        }

        // Renderizado de barra de progreso
        const p = Number(job.progress) || 0;
        const bar = '█'.repeat(Math.floor(p / 10)) + '░'.repeat(10 - Math.floor(p / 10));

        const statusMap: Record<string, string> = {
            'PENDING': '⏳ En Espera',
            'IN_PROGRESS': 'mg En Reparación',
            'DONE': '✅ Listo para entrega'
        };

        await ctx.reply(
            `🚗 *ESTADO DEL VEHÍCULO*\n` +
            `➖➖➖➖➖➖➖➖➖\n` +
            `🆔 *Orden:* #${job.id}\n` +
            `🚙 *Vehículo:* ${job.vehicle_info}\n` +
            `vk *Estado:* ${statusMap[String(job.status)] || job.status}\n` +
            `📊 *Progreso:* \`[${bar}] ${p}%\`\n\n` +
            `📝 *Notas:* ${job.notes || 'Sin observaciones recientes.'}`,
            { parse_mode: "Markdown" }
        );

        await ctx.answerCallbackQuery();
    });

    // Manejo de webhook (Estandar Tardigrade)
    return webhookCallback(bot, "cloudflare-mod")(request);
  },
};
