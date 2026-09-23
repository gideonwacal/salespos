from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0003_workspace_access"),
    ]

    operations = [
        migrations.AlterField(
            model_name="subscriptionpayment",
            name="network",
            field=models.CharField(
                choices=[
                    ("mtn_momo", "MTN Mobile Money"),
                    ("airtel_money", "Airtel Money"),
                    ("bank_card", "Card or bank transfer"),
                ],
                default="mtn_momo",
                max_length=20,
            ),
        ),
    ]
