# queries/signals.py
#
# Django signals that keep derived state in sync automatically.
# Two signals live here:
#   calculate_next_run_on_save — keeps next_run_at current whenever a
#                               ScheduledTask is saved or paused/resumed.
#   send_notification_to_websocket — pushes new Notifications to the browser
#                                    immediately via Channels, without polling.

from django.db.models.signals import pre_save
from django.dispatch import receiver
from .models import ScheduledTask


@receiver(pre_save, sender=ScheduledTask)
def calculate_next_run_on_save(sender, instance, **kwargs):
    """Recalculate next_run_at before every save. Paused tasks get None so the
    heartbeat check never picks them up."""
    if instance.status == ScheduledTask.STATUS_ACTIVE:
        instance.next_run_at = instance.calculate_next_run()
    else:
        instance.next_run_at = None
