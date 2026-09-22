ALTER TABLE "locations" ADD CONSTRAINT "locations_id_tenant_unique" UNIQUE("id","tenant_id");--> statement-breakpoint
CREATE TYPE "public"."availability_override_kind" AS ENUM('added', 'removed');--> statement-breakpoint
CREATE TYPE "public"."double_booking_mode" AS ENUM('disabled', 'manual_override', 'intelligent_overlap');--> statement-breakpoint
CREATE TYPE "public"."duration_display_mode" AS ENUM('exact', 'starting_at', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."price_display_mode" AS ENUM('exact', 'starting_at', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."schedule_block_kind" AS ENUM('work', 'break');--> statement-breakpoint
CREATE TYPE "public"."staff_eligibility_mode" AS ENUM('all_qualified', 'explicit_only');--> statement-breakpoint
CREATE TYPE "public"."staff_service_eligibility" AS ENUM('eligible', 'ineligible');--> statement-breakpoint
CREATE TYPE "public"."time_off_status" AS ENUM('scheduled', 'cancelled');--> statement-breakpoint
CREATE TABLE "add_ons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" integer NOT NULL,
	"duration_minutes" integer NOT NULL,
	"globally_available" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "add_ons_id_tenant_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "add_ons_price_non_negative" CHECK ("add_ons"."price" >= 0),
	CONSTRAINT "add_ons_duration_range" CHECK ("add_ons"."duration_minutes" >= 0 AND "add_ons"."duration_minutes" <= 1440),
	CONSTRAINT "add_ons_sort_order_range" CHECK ("add_ons"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "service_add_ons" (
	"tenant_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"add_on_id" uuid NOT NULL,
	"exclusive_group" text,
	"required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_add_ons_service_id_add_on_id_pk" PRIMARY KEY("service_id","add_on_id"),
	CONSTRAINT "service_add_ons_sort_order_range" CHECK ("service_add_ons"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "service_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_categories_id_tenant_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "service_categories_slug_format" CHECK ("service_categories"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "service_categories_sort_order_range" CHECK ("service_categories"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "service_locations" (
	"tenant_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_locations_service_id_location_id_pk" PRIMARY KEY("service_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "service_prerequisites" (
	"tenant_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"prerequisite_service_id" uuid NOT NULL,
	"may_be_same_booking" boolean DEFAULT true NOT NULL,
	"minimum_elapsed_minutes" integer,
	"maximum_elapsed_minutes" integer,
	"first_time_client_only" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_prerequisites_service_id_prerequisite_service_id_pk" PRIMARY KEY("service_id","prerequisite_service_id"),
	CONSTRAINT "service_prerequisites_not_self" CHECK ("service_prerequisites"."service_id" <> "service_prerequisites"."prerequisite_service_id"),
	CONSTRAINT "service_prerequisites_minimum_non_negative" CHECK ("service_prerequisites"."minimum_elapsed_minutes" IS NULL OR "service_prerequisites"."minimum_elapsed_minutes" >= 0),
	CONSTRAINT "service_prerequisites_elapsed_order" CHECK ("service_prerequisites"."minimum_elapsed_minutes" IS NULL OR "service_prerequisites"."maximum_elapsed_minutes" IS NULL OR "service_prerequisites"."maximum_elapsed_minutes" >= "service_prerequisites"."minimum_elapsed_minutes")
);
--> statement-breakpoint
CREATE TABLE "service_skill_requirements" (
	"tenant_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_skill_requirements_service_id_skill_id_pk" PRIMARY KEY("service_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "service_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" integer NOT NULL,
	"duration_minutes" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_variants_id_tenant_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "service_variants_price_non_negative" CHECK ("service_variants"."price" >= 0),
	CONSTRAINT "service_variants_duration_positive" CHECK ("service_variants"."duration_minutes" > 0 AND "service_variants"."duration_minutes" <= 1440),
	CONSTRAINT "service_variants_sort_order_range" CHECK ("service_variants"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"internal_description" text,
	"base_price" integer NOT NULL,
	"base_duration_minutes" integer NOT NULL,
	"active_time_minutes" integer,
	"processing_time_minutes" integer,
	"active" boolean DEFAULT true NOT NULL,
	"visible_online" boolean DEFAULT true NOT NULL,
	"accepts_online_booking" boolean DEFAULT true NOT NULL,
	"price_display_mode" "price_display_mode" DEFAULT 'exact' NOT NULL,
	"duration_display_mode" "duration_display_mode" DEFAULT 'exact' NOT NULL,
	"buffer_before_minutes" integer,
	"buffer_after_minutes" integer,
	"staff_eligibility_mode" "staff_eligibility_mode" DEFAULT 'all_qualified' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_id_tenant_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "services_base_price_non_negative" CHECK ("services"."base_price" >= 0),
	CONSTRAINT "services_base_duration_positive" CHECK ("services"."base_duration_minutes" > 0 AND "services"."base_duration_minutes" <= 1440),
	CONSTRAINT "services_buffer_before_range" CHECK ("services"."buffer_before_minutes" IS NULL OR ("services"."buffer_before_minutes" >= 0 AND "services"."buffer_before_minutes" <= 1440)),
	CONSTRAINT "services_buffer_after_range" CHECK ("services"."buffer_after_minutes" IS NULL OR ("services"."buffer_after_minutes" >= 0 AND "services"."buffer_after_minutes" <= 1440)),
	CONSTRAINT "services_active_time_range" CHECK ("services"."active_time_minutes" IS NULL OR ("services"."active_time_minutes" > 0 AND "services"."active_time_minutes" <= "services"."base_duration_minutes")),
	CONSTRAINT "services_processing_time_range" CHECK ("services"."processing_time_minutes" IS NULL OR ("services"."processing_time_minutes" >= 0 AND "services"."processing_time_minutes" <= "services"."base_duration_minutes")),
	CONSTRAINT "services_sort_order_range" CHECK ("services"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_id_tenant_unique" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "staff_availability_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"kind" "availability_override_kind" NOT NULL,
	"local_date" date NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_availability_overrides_bounds" CHECK ("staff_availability_overrides"."start_minute" >= 0 AND "staff_availability_overrides"."end_minute" <= 1440 AND "staff_availability_overrides"."start_minute" < "staff_availability_overrides"."end_minute")
);
--> statement-breakpoint
CREATE TABLE "staff_location_assignments" (
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_location_assignments_staff_id_location_id_pk" PRIMARY KEY("staff_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "staff_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"display_name" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"email" text,
	"phone" text,
	"bio" text,
	"active" boolean DEFAULT true NOT NULL,
	"accepts_online_bookings" boolean DEFAULT true NOT NULL,
	"minimum_booking_notice_override_minutes" integer,
	"max_appointments_per_day" integer,
	"max_booked_minutes_per_day" integer,
	"auto_break_enabled" boolean,
	"auto_break_threshold_minutes" integer,
	"auto_break_duration_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_profiles_id_tenant_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "staff_profiles_notice_range" CHECK ("staff_profiles"."minimum_booking_notice_override_minutes" IS NULL OR ("staff_profiles"."minimum_booking_notice_override_minutes" >= 0 AND "staff_profiles"."minimum_booking_notice_override_minutes" <= 525600)),
	CONSTRAINT "staff_profiles_max_appointments_positive" CHECK ("staff_profiles"."max_appointments_per_day" IS NULL OR "staff_profiles"."max_appointments_per_day" > 0),
	CONSTRAINT "staff_profiles_max_minutes_range" CHECK ("staff_profiles"."max_booked_minutes_per_day" IS NULL OR ("staff_profiles"."max_booked_minutes_per_day" > 0 AND "staff_profiles"."max_booked_minutes_per_day" <= 1440)),
	CONSTRAINT "staff_profiles_auto_break_threshold_positive" CHECK ("staff_profiles"."auto_break_threshold_minutes" IS NULL OR "staff_profiles"."auto_break_threshold_minutes" > 0),
	CONSTRAINT "staff_profiles_auto_break_duration_positive" CHECK ("staff_profiles"."auto_break_duration_minutes" IS NULL OR "staff_profiles"."auto_break_duration_minutes" > 0),
	CONSTRAINT "staff_profiles_email_normalized" CHECK ("staff_profiles"."email" IS NULL OR "staff_profiles"."email" = lower(trim("staff_profiles"."email")))
);
--> statement-breakpoint
CREATE TABLE "staff_schedule_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"kind" "schedule_block_kind" DEFAULT 'work' NOT NULL,
	"weekday" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_schedule_blocks_weekday_range" CHECK ("staff_schedule_blocks"."weekday" BETWEEN 1 AND 7),
	CONSTRAINT "staff_schedule_blocks_bounds" CHECK ("staff_schedule_blocks"."start_minute" >= 0 AND "staff_schedule_blocks"."end_minute" <= 1440 AND "staff_schedule_blocks"."start_minute" < "staff_schedule_blocks"."end_minute")
);
--> statement-breakpoint
CREATE TABLE "staff_service_overrides" (
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"price_override" integer,
	"duration_override_minutes" integer,
	"buffer_before_override_minutes" integer,
	"buffer_after_override_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_service_overrides_staff_id_service_id_pk" PRIMARY KEY("staff_id","service_id"),
	CONSTRAINT "staff_service_overrides_price_non_negative" CHECK ("staff_service_overrides"."price_override" IS NULL OR "staff_service_overrides"."price_override" >= 0),
	CONSTRAINT "staff_service_overrides_duration_range" CHECK ("staff_service_overrides"."duration_override_minutes" IS NULL OR ("staff_service_overrides"."duration_override_minutes" > 0 AND "staff_service_overrides"."duration_override_minutes" <= 1440)),
	CONSTRAINT "staff_service_overrides_buffer_before_range" CHECK ("staff_service_overrides"."buffer_before_override_minutes" IS NULL OR ("staff_service_overrides"."buffer_before_override_minutes" >= 0 AND "staff_service_overrides"."buffer_before_override_minutes" <= 1440)),
	CONSTRAINT "staff_service_overrides_buffer_after_range" CHECK ("staff_service_overrides"."buffer_after_override_minutes" IS NULL OR ("staff_service_overrides"."buffer_after_override_minutes" >= 0 AND "staff_service_overrides"."buffer_after_override_minutes" <= 1440))
);
--> statement-breakpoint
CREATE TABLE "staff_services" (
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"eligibility" "staff_service_eligibility" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_services_staff_id_service_id_pk" PRIMARY KEY("staff_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "staff_skills" (
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_skills_staff_id_skill_id_pk" PRIMARY KEY("staff_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "staff_time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"location_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"location_timezone" text NOT NULL,
	"reason" text,
	"status" time_off_status DEFAULT 'scheduled' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_time_off_order" CHECK ("staff_time_off"."ends_at" > "staff_time_off"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "tenant_scheduling_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"default_buffer_before_minutes" integer DEFAULT 0 NOT NULL,
	"default_buffer_after_minutes" integer DEFAULT 10 NOT NULL,
	"minimum_booking_notice_minutes" integer DEFAULT 120 NOT NULL,
	"maximum_booking_horizon_days" integer DEFAULT 60 NOT NULL,
	"double_booking_mode" "double_booking_mode" DEFAULT 'disabled' NOT NULL,
	"auto_break_enabled" boolean DEFAULT false NOT NULL,
	"auto_break_threshold_minutes" integer DEFAULT 240 NOT NULL,
	"auto_break_duration_minutes" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduling_settings_buffer_before_range" CHECK ("tenant_scheduling_settings"."default_buffer_before_minutes" >= 0 AND "tenant_scheduling_settings"."default_buffer_before_minutes" <= 1440),
	CONSTRAINT "scheduling_settings_buffer_after_range" CHECK ("tenant_scheduling_settings"."default_buffer_after_minutes" >= 0 AND "tenant_scheduling_settings"."default_buffer_after_minutes" <= 1440),
	CONSTRAINT "scheduling_settings_notice_range" CHECK ("tenant_scheduling_settings"."minimum_booking_notice_minutes" >= 0 AND "tenant_scheduling_settings"."minimum_booking_notice_minutes" <= 525600),
	CONSTRAINT "scheduling_settings_horizon_range" CHECK ("tenant_scheduling_settings"."maximum_booking_horizon_days" >= 1 AND "tenant_scheduling_settings"."maximum_booking_horizon_days" <= 730),
	CONSTRAINT "scheduling_settings_auto_break_threshold_positive" CHECK ("tenant_scheduling_settings"."auto_break_threshold_minutes" > 0),
	CONSTRAINT "scheduling_settings_auto_break_duration_positive" CHECK ("tenant_scheduling_settings"."auto_break_duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "variant_skill_requirements" (
	"tenant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variant_skill_requirements_variant_id_skill_id_pk" PRIMARY KEY("variant_id","skill_id")
);
--> statement-breakpoint
ALTER TABLE "add_ons" ADD CONSTRAINT "add_ons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_add_ons" ADD CONSTRAINT "service_add_ons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_add_ons" ADD CONSTRAINT "service_add_ons_service_fk" FOREIGN KEY ("service_id","tenant_id") REFERENCES "public"."services"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_add_ons" ADD CONSTRAINT "service_add_ons_add_on_fk" FOREIGN KEY ("add_on_id","tenant_id") REFERENCES "public"."add_ons"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_service_fk" FOREIGN KEY ("service_id","tenant_id") REFERENCES "public"."services"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_location_fk" FOREIGN KEY ("location_id","tenant_id") REFERENCES "public"."locations"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_prerequisites" ADD CONSTRAINT "service_prerequisites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_prerequisites" ADD CONSTRAINT "service_prerequisites_service_fk" FOREIGN KEY ("service_id","tenant_id") REFERENCES "public"."services"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_prerequisites" ADD CONSTRAINT "service_prerequisites_prerequisite_fk" FOREIGN KEY ("prerequisite_service_id","tenant_id") REFERENCES "public"."services"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_skill_requirements" ADD CONSTRAINT "service_skill_requirements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_skill_requirements" ADD CONSTRAINT "service_skill_requirements_service_fk" FOREIGN KEY ("service_id","tenant_id") REFERENCES "public"."services"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_skill_requirements" ADD CONSTRAINT "service_skill_requirements_skill_fk" FOREIGN KEY ("skill_id","tenant_id") REFERENCES "public"."skills"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_variants" ADD CONSTRAINT "service_variants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_variants" ADD CONSTRAINT "service_variants_service_fk" FOREIGN KEY ("service_id","tenant_id") REFERENCES "public"."services"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_category_fk" FOREIGN KEY ("category_id","tenant_id") REFERENCES "public"."service_categories"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_availability_overrides" ADD CONSTRAINT "staff_availability_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_availability_overrides" ADD CONSTRAINT "staff_availability_overrides_staff_fk" FOREIGN KEY ("staff_id","tenant_id") REFERENCES "public"."staff_profiles"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_availability_overrides" ADD CONSTRAINT "staff_availability_overrides_location_fk" FOREIGN KEY ("location_id","tenant_id") REFERENCES "public"."locations"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_location_assignments" ADD CONSTRAINT "staff_location_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_location_assignments" ADD CONSTRAINT "staff_location_assignments_staff_fk" FOREIGN KEY ("staff_id","tenant_id") REFERENCES "public"."staff_profiles"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_location_assignments" ADD CONSTRAINT "staff_location_assignments_location_fk" FOREIGN KEY ("location_id","tenant_id") REFERENCES "public"."locations"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_schedule_blocks" ADD CONSTRAINT "staff_schedule_blocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_schedule_blocks" ADD CONSTRAINT "staff_schedule_blocks_staff_fk" FOREIGN KEY ("staff_id","tenant_id") REFERENCES "public"."staff_profiles"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_schedule_blocks" ADD CONSTRAINT "staff_schedule_blocks_location_fk" FOREIGN KEY ("location_id","tenant_id") REFERENCES "public"."locations"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_service_overrides" ADD CONSTRAINT "staff_service_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_service_overrides" ADD CONSTRAINT "staff_service_overrides_staff_fk" FOREIGN KEY ("staff_id","tenant_id") REFERENCES "public"."staff_profiles"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_service_overrides" ADD CONSTRAINT "staff_service_overrides_service_fk" FOREIGN KEY ("service_id","tenant_id") REFERENCES "public"."services"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_services" ADD CONSTRAINT "staff_services_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_services" ADD CONSTRAINT "staff_services_staff_fk" FOREIGN KEY ("staff_id","tenant_id") REFERENCES "public"."staff_profiles"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_services" ADD CONSTRAINT "staff_services_service_fk" FOREIGN KEY ("service_id","tenant_id") REFERENCES "public"."services"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_skills" ADD CONSTRAINT "staff_skills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_skills" ADD CONSTRAINT "staff_skills_staff_fk" FOREIGN KEY ("staff_id","tenant_id") REFERENCES "public"."staff_profiles"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_skills" ADD CONSTRAINT "staff_skills_skill_fk" FOREIGN KEY ("skill_id","tenant_id") REFERENCES "public"."skills"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_time_off" ADD CONSTRAINT "staff_time_off_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_time_off" ADD CONSTRAINT "staff_time_off_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_time_off" ADD CONSTRAINT "staff_time_off_staff_fk" FOREIGN KEY ("staff_id","tenant_id") REFERENCES "public"."staff_profiles"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_time_off" ADD CONSTRAINT "staff_time_off_location_fk" FOREIGN KEY ("location_id","tenant_id") REFERENCES "public"."locations"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_scheduling_settings" ADD CONSTRAINT "tenant_scheduling_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_skill_requirements" ADD CONSTRAINT "variant_skill_requirements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_skill_requirements" ADD CONSTRAINT "variant_skill_requirements_variant_fk" FOREIGN KEY ("variant_id","tenant_id") REFERENCES "public"."service_variants"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_skill_requirements" ADD CONSTRAINT "variant_skill_requirements_skill_fk" FOREIGN KEY ("skill_id","tenant_id") REFERENCES "public"."skills"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "add_ons_tenant_idx" ON "add_ons" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE INDEX "service_add_ons_add_on_idx" ON "service_add_ons" USING btree ("add_on_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_categories_tenant_slug_unique" ON "service_categories" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "service_categories_tenant_order_idx" ON "service_categories" USING btree ("tenant_id","sort_order");--> statement-breakpoint
CREATE INDEX "service_locations_location_idx" ON "service_locations" USING btree ("location_id","active");--> statement-breakpoint
CREATE INDEX "service_skill_requirements_skill_idx" ON "service_skill_requirements" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "service_variants_service_order_idx" ON "service_variants" USING btree ("service_id","sort_order");--> statement-breakpoint
CREATE INDEX "services_tenant_order_idx" ON "services" USING btree ("tenant_id","sort_order");--> statement-breakpoint
CREATE INDEX "services_tenant_category_idx" ON "services" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_tenant_name_unique" ON "skills" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "skills_tenant_idx" ON "skills" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_availability_overrides_no_duplicates" ON "staff_availability_overrides" USING btree ("staff_id","location_id","kind","local_date","start_minute","end_minute");--> statement-breakpoint
CREATE INDEX "staff_availability_overrides_lookup_idx" ON "staff_availability_overrides" USING btree ("staff_id","local_date");--> statement-breakpoint
CREATE INDEX "staff_location_assignments_location_idx" ON "staff_location_assignments" USING btree ("location_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_profiles_tenant_user_unique" ON "staff_profiles" USING btree ("tenant_id","user_id") WHERE "staff_profiles"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "staff_profiles_tenant_idx" ON "staff_profiles" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_schedule_blocks_no_duplicates" ON "staff_schedule_blocks" USING btree ("staff_id","location_id","kind","weekday","start_minute","end_minute");--> statement-breakpoint
CREATE INDEX "staff_schedule_blocks_lookup_idx" ON "staff_schedule_blocks" USING btree ("staff_id","weekday","active");--> statement-breakpoint
CREATE INDEX "staff_service_overrides_service_idx" ON "staff_service_overrides" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "staff_services_service_idx" ON "staff_services" USING btree ("service_id","eligibility");--> statement-breakpoint
CREATE INDEX "staff_skills_skill_idx" ON "staff_skills" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "staff_time_off_lookup_idx" ON "staff_time_off" USING btree ("staff_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "staff_time_off_tenant_idx" ON "staff_time_off" USING btree ("tenant_id","starts_at");--> statement-breakpoint
CREATE INDEX "variant_skill_requirements_skill_idx" ON "variant_skill_requirements" USING btree ("skill_id");
