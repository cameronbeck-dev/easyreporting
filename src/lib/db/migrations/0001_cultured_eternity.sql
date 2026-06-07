CREATE TABLE `dashboards` (
	`user_id` text NOT NULL,
	`dataset_id` text NOT NULL,
	`layout_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `dataset_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
