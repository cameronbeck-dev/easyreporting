CREATE TABLE `access_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`all_columns` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
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
CREATE TABLE `profile_column_rules` (
	`profile_id` text NOT NULL,
	`dataset_id` text,
	`column_name` text NOT NULL,
	PRIMARY KEY(`profile_id`, `dataset_id`, `column_name`),
	FOREIGN KEY (`profile_id`) REFERENCES `access_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `profile_row_scopes` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`dataset_id` text,
	`column` text NOT NULL,
	`values` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `access_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text,
	`status` text DEFAULT 'invited' NOT NULL,
	`tenant_id` text NOT NULL,
	`role` text NOT NULL,
	`profile_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `access_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);