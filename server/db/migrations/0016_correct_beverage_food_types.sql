UPDATE `foods`
SET `food_type` = 'BEBIDA'
WHERE `category_code` = 'BEBIDAS'
  AND `food_type` <> 'BEBIDA';
