import { getTranslator } from '@aiontheballot/i18n/messages';
import { css } from '@styled-system/css';

const Home = () => {
  const t = getTranslator('es');
  return (
    <main
      className={css({
        maxWidth: '65ch',
        marginInline: 'auto',
        paddingInline: '4',
        paddingBlock: '16',
      })}
    >
      <h1 className={css({ fontSize: '2xl', fontWeight: 'semibold' })}>{t('home.comingSoon')}</h1>
    </main>
  );
};

export default Home;
