from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0004_subscription_payment_network_choices"),
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
                    ("card_stripe", "Card (Stripe)"),
                ],
                default="mtn_momo",
                max_length=20,
            ),
        ),
    ]
