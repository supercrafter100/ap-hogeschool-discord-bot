import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';
import { createServer } from 'http';
import Logger from './Logger.js';
import chalk from 'chalk';

const logger = new Logger();
logger.prefix = chalk.cyan('METRICS');

export const registry = new Registry();
registry.setDefaultLabels({ app: 'ap-discord' });

// Default Node.js process metrics (event loop lag, GC, heap, CPU, etc.)
collectDefaultMetrics({ register: registry });

export const upGauge = new Gauge({
    name: 'ap_discord_up',
    help: 'Always 1 — bot process is up.',
    registers: [registry],
});
upGauge.set(1);

export const messagesProcessed = new Counter({
    name: 'ap_discord_messages_processed_total',
    help: 'Number of inbound messages handled by the bot.',
    labelNames: ['guild'] as const,
    registers: [registry],
});

export const agentRequests = new Counter({
    name: 'ap_discord_agent_requests_total',
    help: 'Number of askAgent invocations, labeled by outcome.',
    labelNames: ['outcome'] as const, // success | error
    registers: [registry],
});

export const agentDuration = new Histogram({
    name: 'ap_discord_agent_duration_seconds',
    help: 'askAgent latency in seconds.',
    buckets: [0.5, 1, 2, 5, 10, 20, 30, 60, 120],
    registers: [registry],
});

export const toolCalls = new Counter({
    name: 'ap_discord_tool_calls_total',
    help: 'Number of tool invocations made by the agent.',
    labelNames: ['tool'] as const,
    registers: [registry],
});

export const activeChains = new Gauge({
    name: 'ap_discord_chains_active',
    help: 'Active chat chains in memory.',
    registers: [registry],
});

export const oerSummaryChars = new Gauge({
    name: 'ap_discord_oer_summary_chars',
    help: 'Character count of the rendered OER summary embedded in the system prompt.',
    registers: [registry],
});

export function startMetricsServer(): void {
    const port = parseInt(process.env.METRICS_PORT ?? '9100', 10);
    const host = process.env.METRICS_HOST ?? '0.0.0.0';

    const server = createServer(async (req, res) => {
        if (!req.url) {
            res.writeHead(404).end();
            return;
        }
        if (req.url === '/metrics') {
            try {
                const body = await registry.metrics();
                res.writeHead(200, { 'Content-Type': registry.contentType });
                res.end(body);
            } catch (err) {
                logger.error('Fout bij genereren metrics:', err);
                res.writeHead(500).end('error');
            }
            return;
        }
        if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
            return;
        }
        res.writeHead(404).end();
    });

    server.listen(port, host, () => {
        logger.info(`Metrics server listening on http://${host}:${port}/metrics`);
    });

    server.on('error', (err) => {
        logger.error('Metrics server error:', err);
    });
}
