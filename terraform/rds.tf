data "aws_db_instance" "db" {
  db_instance_identifier = var.db_instance_id
}
