from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0005_subscription_payment_stripe"),
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
                    ("flutterwave", "Card or mobile money (Flutterwave)"),
                ],
                default="mtn_momo",
                max_length=20,
            ),
        ),
    ]
