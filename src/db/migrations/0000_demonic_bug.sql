CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"name" varchar(256) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"hashed_api_key" varchar(256) NOT NULL,
	"subplan_id" uuid NOT NULL,
	CONSTRAINT "accounts_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"name" varchar(256) NOT NULL,
	"description" varchar(1024) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "plans_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "subplans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"plan_id" uuid NOT NULL,
	"name" varchar(256) NOT NULL,
	"description" varchar(1024) NOT NULL,
	"price" varchar(256) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"monthly_limit" integer NOT NULL,
	"max_request_limit" integer NOT NULL,
	"is_system_plan" boolean DEFAULT false NOT NULL,
	"created_by_account_id" uuid
);
--> statement-breakpoint
CREATE TABLE "usages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"is_success" boolean DEFAULT false NOT NULL,
	"rejected_by" varchar(256) DEFAULT '' NOT NULL,
	"rejected_reason" varchar(256) DEFAULT '' NOT NULL,
	CONSTRAINT "unique_request_constraint" UNIQUE("request_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"email" varchar(256) NOT NULL,
	"hashed_password" varchar(256) NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"account_id" uuid NOT NULL,
	"subplan_id" uuid NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_subplan_id_subplans_id_fk" FOREIGN KEY ("subplan_id") REFERENCES "public"."subplans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subplans" ADD CONSTRAINT "subplans_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usages" ADD CONSTRAINT "usages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usages" ADD CONSTRAINT "usages_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_subplan_id_subplans_id_fk" FOREIGN KEY ("subplan_id") REFERENCES "public"."subplans"("id") ON DELETE cascade ON UPDATE no action;