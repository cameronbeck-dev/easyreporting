CREATE TABLE `access_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`tenant_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`driver` text DEFAULT 'postgres' NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 5432 NOT NULL,
	`database` text NOT NULL,
	`user` text NOT NULL,
	`password_encrypted` text NOT NULL,
	`ssl_mode` text DEFAULT 'disable' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `datasets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`connection_id` text,
	`table_name` text,
	`tenant_column` text NOT NULL,
	`columns_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash_unique` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE TABLE `profile_row_scopes` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`dataset_id` text,
	`column` text NOT NULL,
	`values` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `access_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tenant_column_rules` (
	`tenant_id` text NOT NULL,
	`dataset_id` text,
	`column_name` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `dataset_id`, `column_name`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text,
	`status` text DEFAULT 'invited' NOT NULL,
	`tenant_id` text NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`profile_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `access_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);