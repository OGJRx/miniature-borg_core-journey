import { Bot, Context, webhookCallback, InlineKeyboard } from "grammy";

// 1. Definición estricta de variables de entorno
interface Env {
  TELEGRAM_BOT_TOKEN: string;
  DB: D1Database;
  CALENDAR_URL: string;
  SUPPORT_URL: string;
}

type MyContext = Context & { env: Env };

export default {
  async fetch(request: Request, env: Env, executionContext: ExecutionContext): Promise<Response> {
    const bot = new Bot<MyContext>(env.TELEGRAM_BOT_TOKEN);

    // Middleware: Inyectar entorno en el contexto
    bot.use(async (ctx, next) => {
      ctx.env = env;
      await next();
    });

    // --- COMANDO /start ---
    bot.command(["start", "agendar"], async (ctx) => {
      const user = ctx.from;
      if (!user) return;

      // Registro de usuario "Fire & Forget" (No bloqueante)
      const query = `
        INSERT INTO users (telegram_id, first_name, username)
        VALUES (?, ?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET first_name=excluded.first_name
      `;
      ctx.env.DB.prepare(query)
        .bind(user.id, user.first_name, user.username || '')
        .run()
        .catch(console.error);

      // UI: Botones conectados a las variables de entorno
      // IMPORTANTE: CALENDAR_URL viene del wrangler.toml
      const keyboard = new InlineKeyboard()
        .url("📅 Agendar Cita (Google Calendar)", ctx.env.CALENDAR_URL)
        .row()
        .text("🚗 Ver Estado de mi Auto", "check_status")
        .row()
        .url("sos Soporte Humano", ctx.env.SUPPORT_URL || "https://t.me/AdminSoporte");

      await ctx.reply(
        `👋 *Hola ${user.first_name}.*\n\n` +
        `Bienvenido al sistema Borgptron Titanium.\n` +
        `Gestión de taller automatizada y sin esperas.\n\n` +
        `👇 *Selecciona una opción:*`,
        { parse_mode: "Markdown", reply_markup: keyboard }
      );
    });

    // --- ACCIÓN /check_status ---
    bot.callbackQuery("check_status", async (ctx) => {
        const userId = ctx.from.id;

        // Consulta optimizada a D1
        const job = await ctx.env.DB.prepare(`
            SELECT id, vehicle_info, status, progress, notes
            FROM jobs
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT 1
        `).bind(userId).first();

        if (!job) {
            return ctx.answerCallbackQuery({
                text: "❌ No tienes órdenes activas.\nAgenda tu cita primero.",
                show_alert: true
            });
        }

        // Renderizado de Barra de Progreso
        const p = Number(job.progress) || 0;
        const bar = '█'.repeat(Math.floor(p / 10)) + '░'.repeat(10 - Math.floor(p / 10));

        const statusMap: Record<string, string> = {
            'PENDING': '⏳ En Espera',
            'IN_PROGRESS': '🔧 En Taller',
            'READY': '✨ Listo',
            'DELIVERED': '✅ Entregado'
        };

        await ctx.reply(
            `🚗 *ESTADO DE TU VEHÍCULO*\n` +
            `➖➖➖➖➖➖➖➖➖\n` +
            `🆔 *Orden:* #${job.id}\n` +
            `🚙 *Auto:* ${job.vehicle_info}\n` +
            `📍 *Estado:* ${statusMap[String(job.status)] || job.status}\n` +
            `📊 *Avance:* \`[${bar}] ${p}%\`\n\n` +
            `📝 *Nota:* ${job.notes || 'Sin novedades.'}`,
            { parse_mode: "Markdown" }
        );

        await ctx.answerCallbackQuery();
    });

    return webhookCallback(bot, "cloudflare-mod")(request);
  },
};
