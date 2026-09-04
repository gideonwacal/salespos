from django.db.models import Sum
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.tenancy import WorkspaceViewSet
from apps.expenses.models import Expense
from apps.expenses.serializers import ExpenseSerializer


class ExpenseViewSet(WorkspaceViewSet):
    queryset = Expense.objects.all()
    serializer_class = ExpenseSerializer
    filterset_fields = ["status", "category", "payment_method"]
    search_fields = ["category", "vendor", "description"]
    ordering_fields = ["expense_date", "amount", "created_at"]

    def perform_create(self, serializer):
        serializer.save(workspace=self.request.workspace, logged_by=self.request.user)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._set_status(request, "approved")

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._set_status(request, "rejected")

    def _set_status(self, request, value):
        if request.workspace_role != "owner":
            self.permission_denied(
                request, message="Only the workspace owner can approve or reject expenses."
            )
        expense = self.get_object()
        expense.status = value
        expense.save(update_fields=["status"])
        return Response(self.get_serializer(expense).data)

    @action(detail=False, methods=["get"])
    def summary(self, request):
        rows = (
            self.get_queryset()
            .values("category")
            .annotate(total=Sum("amount"))
            .order_by("-total")
        )
        total = self.get_queryset().aggregate(total=Sum("amount"))["total"] or 0
        return Response({"total": total, "by_category": list(rows)})
