/**
 * PM2 ecosystem config for WhatsApp AI Gateway
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 restart mi-whatsapp-gateway
 *   pm2 stop mi-whatsapp-gateway
 *   pm2 logs mi-whatsapp-gateway
 *   pm2 delete mi-whatsapp-gateway
 */
module.exports = {
    apps: [
        {
            name: "mi-whatsapp-gateway",
            script: "src/index.js",
            cwd: __dirname,
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: "1G",
            kill_timeout: 5000,
            wait_ready: false,
            // Load .env automatically (dotenv is also required inside the app)
            node_args: ["--max-old-space-size=1024"],
            // Use the project's own logs dir; PM2 will write pm2 logs separately
            out_file: "./logs/pm2.out.log",
            error_file: "./logs/pm2.error.log",
            merge_logs: true,
            time: true,
            env: {
                NODE_ENV: "production",
            },
            env_production: {
                NODE_ENV: "production",
            },
        },
    ],
};