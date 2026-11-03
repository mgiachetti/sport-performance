import type { CalendarEvent } from '@sport-performance/contracts';
import { localDateParts, type LocalDate } from '@sport-performance/domain';
import { formatLocalDateLong, formatLocalMonth } from '@sport-performance/i18n';
import { useT } from '../i18n/i18n';
import { Icon } from '../ui/icons';
import {
  calendarDays,
  sessionWindowLabel,
  type CalendarMonth,
  type DayEvent,
  type MonthGrid,
} from './model';
import {
  EventSummary,
  WindowBand,
  useWindowName,
  useWindowSpanText,
  type SportOfSeason,
} from './parts';

const WEEKDAYS = ['1', '2', '3', '4', '5', '6', '7'] as const;

export interface CalendarViewProps {
  readonly month: CalendarMonth;
  readonly grid: MonthGrid;
  readonly events: readonly CalendarEvent[];
  readonly today: LocalDate;
  /** Show the category on each event (no category picked in the layout). */
  readonly showCategory: boolean;
  readonly sportOfSeason: SportOfSeason;
  readonly onOpen: (event: DayEvent) => void;
}

function windowLabelOf(events: readonly CalendarEvent[], event: DayEvent): string | null {
  return event.type === 'test_session'
    ? sessionWindowLabel(events, event.testSession.testWindowId)
    : null;
}

function eventKey(event: DayEvent): string {
  return event.type === 'test_session' ? event.testSession.id : event.fixture.id;
}

/**
 * The month as a table (Monday to Sunday): each cell names its day, the
 * windows it falls in and its test days and matches, which open the editor.
 * Screen readers get the weekday from the column header and the full date
 * from the cell.
 */
export function MonthGridView(props: CalendarViewProps) {
  const t = useT();
  const monthName = formatLocalMonth(props.month.year, props.month.month);
  return (
    <div className="sp-cal__grid-wrap">
      <table className="sp-cal__grid">
        <caption className="sp-visually-hidden">
          {t('calendar.grid.caption', { month: monthName })}
        </caption>
        <thead>
          <tr>
            {WEEKDAYS.map((day) => (
              <th key={day} scope="col">
                <abbr title={t(`calendar.weekday.${day}`)}>
                  {t(`calendar.weekdayShort.${day}`)}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.grid.weeks.map((week) => {
            const days = calendarDays(week, props.events, props.month, props.today);
            return (
              <tr key={week[0]}>
                {days.map((day) => (
                  <td
                    key={day.date}
                    className={[
                      'sp-cal__day',
                      day.inMonth ? null : 'sp-cal__day--outside',
                      day.isToday ? 'sp-cal__day--today' : null,
                      day.windows.length > 0 ? 'sp-cal__day--window' : null,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-current={day.isToday ? 'date' : undefined}
                  >
                    <p className="sp-cal__day-head">
                      <span aria-hidden="true" className="sp-cal__day-number">
                        {localDateParts(day.date).day}
                      </span>
                      <span className="sp-visually-hidden">{formatLocalDateLong(day.date)}</span>
                      {day.isToday ? (
                        <span className="sp-cal__today">{t('calendar.day.today')}</span>
                      ) : null}
                      {day.inMonth ? null : (
                        <span className="sp-visually-hidden">{t('calendar.day.outsideMonth')}</span>
                      )}
                    </p>
                    {day.windows.map((event) => (
                      <WindowBand key={event.testWindow.id} event={event} />
                    ))}
                    {day.items.length === 0 ? null : (
                      <ul className="sp-cal__events">
                        {day.items.map((event) => (
                          <li key={eventKey(event)}>
                            <button
                              type="button"
                              className={`sp-cal__event sp-cal__event--${event.type}`}
                              onClick={() => {
                                props.onOpen(event);
                              }}
                            >
                              <EventSummary
                                event={event}
                                compact
                                showCategory={props.showCategory}
                                windowLabel={windowLabelOf(props.events, event)}
                              />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The same month as a list: its windows, then each day with activity. */
export function AgendaView(props: CalendarViewProps) {
  const t = useT();
  const windowName = useWindowName(props.sportOfSeason);
  const windowSpan = useWindowSpanText(props.sportOfSeason);
  const dates = props.grid.weeks.flat();
  const days = calendarDays(dates, props.events, props.month, props.today).filter(
    (day) => day.inMonth && day.items.length > 0,
  );
  const windows = props.events.filter(
    (event): event is Extract<CalendarEvent, { type: 'test_window' }> =>
      event.type === 'test_window',
  );

  return (
    <div className="sp-cal__agenda">
      <section aria-labelledby="calendar-list-windows">
        <h2 id="calendar-list-windows" className="sp-cal__agenda-title">
          {t('calendar.list.windows')}
        </h2>
        {windows.length === 0 ? (
          <p>{t('calendar.list.noWindows')}</p>
        ) : (
          <ul className="sp-cal__agenda-list">
            {windows.map((event) => (
              <li key={event.testWindow.id} className="sp-cal__agenda-window">
                <Icon name="calendar" />
                <span>{windowSpan(event)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="calendar-list-days">
        <h2 id="calendar-list-days" className="sp-cal__agenda-title">
          {t('calendar.list.days')}
        </h2>
        {days.length === 0 ? (
          <p>{t('calendar.list.empty')}</p>
        ) : (
          <ol className="sp-cal__agenda-list">
            {days.map((day) => (
              <li key={day.date} className="sp-cal__agenda-day">
                <h3 className="sp-cal__agenda-date">
                  {formatLocalDateLong(day.date)}
                  {day.isToday ? (
                    <span className="sp-cal__today">{t('calendar.day.today')}</span>
                  ) : null}
                </h3>
                {day.windows.length === 0 ? null : (
                  <p className="sp-cal__agenda-meta">
                    {day.windows.map((event) => windowName(event)).join(', ')}
                  </p>
                )}
                <ul className="sp-cal__events">
                  {day.items.map((event) => (
                    <li key={eventKey(event)}>
                      <button
                        type="button"
                        className={`sp-cal__event sp-cal__event--${event.type}`}
                        onClick={() => {
                          props.onOpen(event);
                        }}
                      >
                        <EventSummary
                          event={event}
                          compact={false}
                          showCategory={props.showCategory}
                          windowLabel={windowLabelOf(props.events, event)}
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
