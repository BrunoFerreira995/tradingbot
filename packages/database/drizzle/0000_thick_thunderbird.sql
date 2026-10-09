CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" varchar(20) NOT NULL,
	"event" varchar(100) NOT NULL,
	"request_id" varchar(100),
	"ip" varchar(100),
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broker_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(30) NOT NULL,
	"external_id" varchar(120) NOT NULL,
	"mode" varchar(10) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid,
	"client_order_id" varchar(300) NOT NULL,
	"broker_order_id" varchar(120),
	"symbol" varchar(30) NOT NULL,
	"side" varchar(8) NOT NULL,
	"type" varchar(20) DEFAULT 'MARKET' NOT NULL,
	"lots" numeric(20, 8) NOT NULL,
	"requested_price" numeric(20, 8),
	"executed_price" numeric(20, 8),
	"slippage" numeric(20, 8),
	"stop_loss" numeric(20, 8),
	"take_profit" numeric(20, 8),
	"status" varchar(24) NOT NULL,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_client_order_id_unique" UNIQUE("client_order_id")
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broker_position_id" varchar(120) NOT NULL,
	"symbol" varchar(30) NOT NULL,
	"side" varchar(8) NOT NULL,
	"lots" numeric(20, 8) NOT NULL,
	"entry_price" numeric(20, 8) NOT NULL,
	"current_price" numeric(20, 8),
	"unrealized_pnl" numeric(20, 8),
	"stop_loss" numeric(20, 8),
	"take_profit" numeric(20, 8),
	"status" varchar(12) DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "positions_broker_position_id_unique" UNIQUE("broker_position_id")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" varchar(200) PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"auto_trading_enabled" boolean DEFAULT false NOT NULL,
	"emergency_stop" boolean DEFAULT false NOT NULL,
	"maximum_lot_size" numeric(20, 8) DEFAULT '0.01' NOT NULL,
	"minimum_lot_size" numeric(20, 8),
	"maximum_open_positions" integer DEFAULT 1 NOT NULL,
	"maximum_positions_per_symbol" integer DEFAULT 1 NOT NULL,
	"maximum_daily_loss" numeric(20, 8),
	"maximum_daily_trades" integer,
	"maximum_exposure" numeric(20, 8),
	"maximum_margin_usage_percentage" numeric(20, 8),
	"allowed_symbols" jsonb DEFAULT '["XAUUSD"]'::jsonb NOT NULL,
	"blocked_symbols" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"require_stop_loss" boolean DEFAULT true NOT NULL,
	"minimum_stop_distance" numeric(20, 8),
	"maximum_stop_distance" numeric(20, 8),
	"position_policy" varchar(40) DEFAULT 'ONE_POSITION_PER_SYMBOL' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"allowed_symbols" jsonb DEFAULT '["XAUUSD"]'::jsonb NOT NULL,
	"max_lot" numeric(20, 8),
	"risk_percentage" numeric(20, 8),
	"max_daily_trades" integer,
	"max_daily_loss" numeric(20, 8),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategies_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "system_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid,
	"symbol" varchar(30) NOT NULL,
	"side" varchar(8) NOT NULL,
	"lots" numeric(20, 8) NOT NULL,
	"entry_price" numeric(20, 8) NOT NULL,
	"exit_price" numeric(20, 8) NOT NULL,
	"pnl" numeric(20, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" varchar(160) NOT NULL,
	"strategy" varchar(100) NOT NULL,
	"symbol" varchar(30) NOT NULL,
	"action" varchar(20) NOT NULL,
	"order_type" varchar(20) NOT NULL,
	"lots" numeric(20, 8),
	"stop_loss" numeric(20, 8),
	"take_profit" numeric(20, 8),
	"price" numeric(20, 8),
	"timeframe" varchar(20),
	"status" varchar(20) DEFAULT 'RECEIVED' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"raw_payload" jsonb NOT NULL,
	"webhook_processing_ms" integer,
	"risk_processing_ms" integer,
	"total_execution_ms" integer,
	CONSTRAINT "trading_signals_signal_id_unique" UNIQUE("signal_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webhook_nonces" (
	"nonce" varchar(128) PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_signal_id_trading_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."trading_signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_settings" ADD CONSTRAINT "risk_settings_account_id_broker_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."broker_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_key_idx" ON "rate_limits" USING btree ("key");--> statement-breakpoint
CREATE INDEX "events_created_idx" ON "system_events" USING btree ("created_at");