import { Bot, Context as GrammyContext, webhookCallback } from "grammy";

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  GAS_API_URL: string;
  GAS_API_KEY: string;
  STAFF_GROUP_ID: string;
}

interface Job {
  ID?: string;
  chat_id: number | string;
  client_name: string;
  vehicle_info: string;
  status: string;
  notes: string;
  progress: number;
  is_lead: boolean;
  created_at?: string;
}

type MyContext = GrammyContext & { 
  env: Env;
  dbClient: (action: string, payload: any) => Promise<any>;
  waitUntil: (promise: Promise<any>) => void;
};

const STEPS = {
  IDLE: 'IDLE',
  AWAIT_NAME: 'AWAIT_NAME',
  AWAIT_VEHICLE: 'AWAIT_VEHICLE',
  AWAIT_DESC: 'AWAIT_DESC',
} as const;

const gasApiClient = (env: Env) => async (action: string, payload: any = {}) => {
  if (!env.GAS_API_URL) throw new Error("GAS_API_URL not configured.");

  const requestPayload = {
    apiKey: env.GAS_API_KEY,
    action,
    ...payload,
  };

  try {
    const response = await fetch(env.GAS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    });

    const text = await response.text();

    if (!response.ok) {
        console.error(`GAS HTTP Error (${response.status}): ${text}`);
        throw new Error(`HTTP Error: ${response.status}`);
    }

    try {
        const data = JSON.parse(text);
        if (!data.ok) throw new Error(`GAS Logic Error: ${data.error}`);
        return data.result;
    } catch (parseError) {
        console.error(`GAS Response is NOT JSON: ${text}`);
        throw new Error("Invalid JSON from GAS. Check logs.");
    }
    
  } catch (err) {
    console.error(`DB Action '${action}' failed:`, err);
    throw err;
  }
};

async function updateSession(ctx: MyContext, step: string, tempData: any, isClear: boolean = false): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  
  try {
      await ctx.dbClient('WRITE_SESSION', { userId, currentStep: step, tempData, isClear });
  } catch (error) {
      console.error("Error guardando sesión:", error);
      await ctx.reply("⚠️ Error de conexión con la memoria. Intenta de nuevo.");
  }
}

function renderProgressBar(progress: number): string {
  const p = Math.max(0, Math.min(100, progress || 0));
  const filled = '█'.repeat(Math.floor(p / 10));
  const empty = '░'.repeat(10 - Math.floor(p / 10));
  return `[${filled}${empty}] ${p}%`;
}

function registerHandlers(bot: Bot<MyContext>) {
    
    bot.command(['start', 'agendar'], async (ctx) => {
      await updateSession(ctx, STEPS.AWAIT_NAME, {}, true);
      await ctx.reply("🔧 *CITA INICIADA*\nIngresa tu *nombre completo*.", { parse_mode: 'Markdown' });
    });

    bot.command('estado', async (ctx) => {
      const chatId = ctx.chat?.id;
      if (!chatId) return;
      try {
        const jobs: Job[] = await ctx.dbClient('QUERY_JOBS', { chatId });
        if (!jobs || jobs.length === 0) return ctx.reply("❌ No hay vehículos activos. Usa /agendar.");
        const job = jobs[jobs.length - 1];
        const statusText = (job.status || 'UNKNOWN').toUpperCase().replace(/_/g, ' ');
        await ctx.reply(
          `🚗 *ESTADO DE TU VEHÍCULO*\n` +
          `*Orden ID:* #${job.ID || 'PEND'}\n` +
          `*Cliente:* ${job.client_name}\n` +
          `*Vehículo:* ${job.vehicle_info}\n\n` +
          `*Estatus:* ${statusText}\n` +
          `*Progreso:* ${renderProgressBar(job.progress)}\n` +
          `*Notas:* ${job.notes || 'En revisión.'}`,
          { parse_mode: 'Markdown' }
        );
      } catch (e) {
        console.error(e);
        await ctx.reply("⚠️ Error consultando estado.");
      }
    });

    bot.command('cotizar', async (ctx) => {
      const chatId = ctx.chat?.id;
      const clientName = ctx.from?.first_name || "Usuario";
      const jobData: Job = {
        chat_id: chatId!,
        client_name: clientName,
        vehicle_info: ctx.match?.toString() || 'Solicitud Genérica',
        status: 'LEAD',
        notes: 'Requiere cotización',
        progress: 0,
        is_lead: true
      };
      ctx.waitUntil(ctx.dbClient('SAVE_JOB', { jobData }));
      if (ctx.env.STAFF_GROUP_ID) {
        ctx.waitUntil(ctx.api.sendMessage(
            ctx.env.STAFF_GROUP_ID, 
            `🚨 *NUEVO LEAD*\nCliente: ${clientName}\nInfo: ${jobData.vehicle_info}`,
            { parse_mode: 'Markdown' }
        ).catch(() => {}));
      }
      await ctx.reply("📝 Un técnico te contactará en breve.");
    });

    bot.on('message:text', async (ctx) => {
      if (ctx.message.text.startsWith('/')) return;
      const userId = ctx.from?.id;
      const input = ctx.message.text.trim();
      let session;
      try {
         session = await ctx.dbClient('READ_SESSION', { userId });
      } catch (e) {
         session = { current_step: STEPS.IDLE, temp_data: {} };
      }
      const step = session.current_step || STEPS.IDLE;
      const tempData = session.temp_data || {};
      let nextStep = step;
      let replyText = "";
      switch (step) {
        case STEPS.AWAIT_NAME:
            if (input.length < 3) replyText = "⚠️ Nombre muy corto.";
            else {
                tempData.client_name = input;
                nextStep = STEPS.AWAIT_VEHICLE;
                replyText = `✅ Hola ${input}. ¿Qué *marca, modelo y año* es el auto?`;
                await updateSession(ctx, nextStep, tempData);
            }
            break;
        case STEPS.AWAIT_VEHICLE:
            if (input.length < 2) replyText = "⚠️ Info muy corta.";
            else {
                tempData.vehicle_info = input;
                nextStep = STEPS.AWAIT_DESC;
                replyText = "✅ Entendido. *Describe el problema* que tiene.";
                await updateSession(ctx, nextStep, tempData);
            }
            break;
        case STEPS.AWAIT_DESC:
            const jobData: Job = {
                chat_id: ctx.chat!.id,
                client_name: tempData.client_name,
                vehicle_info: tempData.vehicle_info,
                notes: input,
                status: 'SCHEDULED',
                progress: 0,
                is_lead: false
            };
            const savePromise = ctx.dbClient('SAVE_JOB', { jobData });
            if (ctx.env.STAFF_GROUP_ID) {
                const staffMsg = `🆕 *NUEVA CITA*\nCliente: ${jobData.client_name}\nAuto: ${jobData.vehicle_info}\nFalla: ${jobData.notes}`;
                ctx.waitUntil(ctx.api.sendMessage(ctx.env.STAFF_GROUP_ID, staffMsg, { parse_mode: 'Markdown' }).catch(()=>{}));
            }
            await updateSession(ctx, STEPS.IDLE, {}, true);
            await savePromise;
            replyText = "✅ ¡Listo! Tu cita ha sido registrada.";
            nextStep = STEPS.IDLE;
            break;
        default:
            // Si el input empieza con '/', es un comando y lo ignoramos (lo maneja bot.command)
            if (input.startsWith('/')) return;

            // DIAGNÓSTICO EN TIEMPO REAL PARA EL USUARIO
            await ctx.reply(
                `⚠️ *Desincronización detectada.*\n` +
                `El cerebro del sistema reporta estado: \`${step}\`\n` +
                `Pero tú esperabas otra cosa. Por favor escribe /start para forzar el reinicio.`,
                { parse_mode: 'Markdown' }
            );
            break;
      }
      if (replyText) await ctx.reply(replyText, { parse_mode: 'Markdown' });
    });
}

export default {
  async fetch(request: Request, env: Env, executionContext: ExecutionContext): Promise<Response> {
    const bot = new Bot<MyContext>(env.TELEGRAM_BOT_TOKEN, { 
      botInfo: {
        id: 6617778072,
        is_bot: true,
        first_name: "OGJR",
        username: "OGJRbot",
        can_join_groups: true,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false
      }
    });
    bot.use(async (ctx, next) => {
      ctx.env = env;
      ctx.dbClient = gasApiClient(env);
      ctx.waitUntil = executionContext.waitUntil.bind(executionContext);
      await next();
    });
    registerHandlers(bot);
    return webhookCallback(bot, 'cloudflare-mod')(request);
  },
};