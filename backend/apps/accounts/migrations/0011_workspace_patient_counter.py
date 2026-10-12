from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0010_workspace_review"),
    ]

    operations = [
        migrations.AddField(
            model_name="workspace",
            name="patient_counter",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
