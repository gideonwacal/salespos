from django.db import migrations, models


class Migration(migrations.Migration):
    """Back to the three rails money actually arrives on here.

    The gateway choices came and went without a deployment ever using them, so
    there is no data to migrate — only the field's choices to put right.
    """

    dependencies = [
        ("accounts", "0006_subscription_payment_flutterwave"),
    ]

    operations = [
        migrations.AlterField(
            model_name="subscriptionpayment",
            name="network",
            field=models.CharField(
                choices=[
                    ("mtn_momo", "MTN Mobile Money"),
                    ("airtel_money", "Airtel Money"),
                    ("bank_card", "Bank transfer"),
                ],
                default="mtn_momo",
                max_length=20,
            ),
        ),
    ]
