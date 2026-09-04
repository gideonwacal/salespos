
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_stock_transaction() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_sale_item() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_owner() FROM anon;
