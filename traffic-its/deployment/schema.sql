
CREATE TABLE its_alert_revisions (
	key VARCHAR(80) NOT NULL,
	alert_id VARCHAR(36) NOT NULL,
	revision INTEGER NOT NULL,
	payload JSON NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (key)
)

;
CREATE INDEX ix_its_alert_revisions_alert_id ON its_alert_revisions (alert_id);

CREATE TABLE its_alerts (
	id VARCHAR(36) NOT NULL,
	camera_id VARCHAR(200) NOT NULL,
	source_mode VARCHAR(20) NOT NULL,
	revision INTEGER NOT NULL,
	payload JSON NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id)
)

;
CREATE INDEX ix_its_alerts_camera_id ON its_alerts (camera_id);

CREATE TABLE its_camera_leases (
	camera_id VARCHAR(200) NOT NULL,
	owner VARCHAR(200) NOT NULL,
	fencing_token BIGINT NOT NULL,
	lease_until TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (camera_id)
)

;

CREATE TABLE its_cameras (
	id VARCHAR(200) NOT NULL,
	config JSON NOT NULL,
	PRIMARY KEY (id)
)

;

CREATE TABLE its_current_states (
	camera_id VARCHAR(200) NOT NULL,
	revision INTEGER NOT NULL,
	payload JSON NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (camera_id)
)

;

CREATE TABLE its_delivery_counter (
	id SERIAL NOT NULL,
	sequence BIGINT NOT NULL,
	expired_through BIGINT NOT NULL,
	PRIMARY KEY (id)
)

;

CREATE TABLE its_delivery_events (
	sequence BIGSERIAL NOT NULL,
	event_id VARCHAR(36) NOT NULL,
	entity_id VARCHAR(200) NOT NULL,
	revision INTEGER NOT NULL,
	event_type VARCHAR(80) NOT NULL,
	source_mode VARCHAR(20) NOT NULL,
	payload JSON NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (sequence),
	UNIQUE (event_id)
)

;
CREATE INDEX ix_its_delivery_events_created_at ON its_delivery_events (created_at);

CREATE TABLE its_metric_windows (
	key VARCHAR(64) NOT NULL,
	camera_id VARCHAR(200) NOT NULL,
	lane_id VARCHAR(200),
	source_mode VARCHAR(20) NOT NULL,
	bin_start_s FLOAT,
	received_at TIMESTAMP WITH TIME ZONE NOT NULL,
	payload JSON NOT NULL,
	PRIMARY KEY (key)
)

;
CREATE INDEX ix_its_metric_windows_camera_id ON its_metric_windows (camera_id);
CREATE INDEX ix_its_metric_windows_received_at ON its_metric_windows (received_at);

CREATE TABLE its_outbox (
	producer_sequence SERIAL NOT NULL,
	event_id VARCHAR(36) NOT NULL,
	entity_id VARCHAR(200) NOT NULL,
	revision INTEGER NOT NULL,
	event_type VARCHAR(80) NOT NULL,
	source_mode VARCHAR(20) NOT NULL,
	payload JSON NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	delivered BOOLEAN NOT NULL,
	PRIMARY KEY (producer_sequence),
	UNIQUE (event_id)
)

;
CREATE INDEX ix_its_outbox_delivered ON its_outbox (delivered);
